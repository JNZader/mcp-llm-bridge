/**
 * ACP Server
 *
 * Receives ACP (Agent Client Protocol) requests from code editors
 * and translates them into bridge generate calls via the translator.
 *
 * The server manages task lifecycle (create, message, cancel, query)
 * and dispatches work through the existing bridge pipeline.
 *
 * Architecture:
 *   Editor → ACP Server → Translator → Bridge Orchestrator → LLM Provider
 *                                    → MCP Tool Calls (if needed)
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpStartTaskParams,
  AcpStartTaskResult,
  AcpSendMessageParams,
  AcpSendMessageResult,
  AcpCancelTaskParams,
  AcpCancelTaskResult,
  AcpGetTaskParams,
  AcpGetTaskResult,
  AcpListTasksParams,
  AcpListTasksResult,
  AcpTask,
  AcpTaskStatus,
  AcpServerCapabilities,
  AcpProgressNotification,
  AcpTaskUpdateNotification,
} from './types.js';
import { ACP_METHODS, ACP_ERROR_CODES } from './types.js';
import { AcpToMcpTranslator, type TranslationContext } from './translator.js';

// ─── Handler Contract ────────────────────────────────────────

/**
 * Function that executes a prompt through the bridge pipeline.
 * The ACP server is decoupled from the bridge — it only knows
 * about this function signature.
 */
export type GenerateHandler = (params: {
  prompt: string;
  system?: string;
}) => Promise<{ text: string; provider: string; model: string }>;

/**
 * Callback for sending notifications to the ACP client (editor).
 */
export type NotificationHandler = (
  notification: AcpProgressNotification | AcpTaskUpdateNotification,
) => void;

// ─── Server Configuration ────────────────────────────────────

export interface AcpServerConfig {
  /** Server name (shown to clients during initialize) */
  serverName?: string;
  /** Server version */
  serverVersion?: string;
  /** Maximum number of concurrent tasks */
  maxConcurrentTasks?: number;
  /** Maximum stored tasks (completed tasks get evicted first) */
  maxStoredTasks?: number;
}

const DEFAULT_CONFIG: Required<AcpServerConfig> = {
  serverName: 'mcp-llm-bridge',
  serverVersion: '0.4.0',
  maxConcurrentTasks: 10,
  maxStoredTasks: 100,
};

// ─── ACP Server ──────────────────────────────────────────────

export class AcpServer {
  private readonly config: Required<AcpServerConfig>;
  private readonly translator: AcpToMcpTranslator;
  private readonly tasks: Map<string, AcpTask>;
  private readonly contexts: Map<string, TranslationContext>;
  private readonly generateHandler: GenerateHandler;
  private notificationHandler: NotificationHandler | null;
  private initialized: boolean;
  private taskCounter: number;

  constructor(generateHandler: GenerateHandler, config?: AcpServerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.translator = new AcpToMcpTranslator();
    this.tasks = new Map();
    this.contexts = new Map();
    this.generateHandler = generateHandler;
    this.notificationHandler = null;
    this.initialized = false;
    this.taskCounter = 0;
  }

  /**
   * Register a notification handler for server→client messages.
   */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /**
   * Handle an incoming JSON-RPC request from the ACP client.
   *
   * This is the main entry point — route by method name.
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const result = await this.dispatch(request);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      const err = error as { code?: number; message?: string };
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: err.code ?? ACP_ERROR_CODES.INTERNAL_ERROR,
          message: err.message ?? 'Internal server error',
        },
      };
    }
  }

  // ─── Method Dispatch ─────────────────────────────────────────

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case ACP_METHODS.INITIALIZE:
        return this.handleInitialize(request.params as AcpInitializeParams);
      case ACP_METHODS.START_TASK:
        return this.handleStartTask(request.params as AcpStartTaskParams);
      case ACP_METHODS.SEND_MESSAGE:
        return this.handleSendMessage(request.params as AcpSendMessageParams);
      case ACP_METHODS.CANCEL_TASK:
        return this.handleCancelTask(request.params as AcpCancelTaskParams);
      case ACP_METHODS.GET_TASK:
        return this.handleGetTask(request.params as AcpGetTaskParams);
      case ACP_METHODS.LIST_TASKS:
        return this.handleListTasks(request.params as AcpListTasksParams);
      default:
        throw this.rpcError(ACP_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
    }
  }

  // ─── Initialize ──────────────────────────────────────────────

  private handleInitialize(_params: AcpInitializeParams): AcpInitializeResult {
    const capabilities: AcpServerCapabilities = {
      protocolVersion: '0.1.0',
      serverName: this.config.serverName,
      serverVersion: this.config.serverVersion,
      features: ['tasks', 'messages', 'cancellation', 'progress'],
    };

    this.initialized = true;

    return { serverCapabilities: capabilities };
  }

  // ─── Start Task ──────────────────────────────────────────────

  private async handleStartTask(params: AcpStartTaskParams): Promise<AcpStartTaskResult> {
    this.ensureInitialized();

    if (!params.description || params.description.trim() === '') {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'Task description is required');
    }

    // Check concurrent task limit
    const activeTasks = this.countTasksByStatus('running');
    if (activeTasks >= this.config.maxConcurrentTasks) {
      throw this.rpcError(
        ACP_ERROR_CODES.INVALID_TASK_STATE,
        `Maximum concurrent tasks (${this.config.maxConcurrentTasks}) reached`,
      );
    }

    // Evict old completed tasks if at capacity
    this.evictOldTasks();

    const taskId = this.generateTaskId();
    const now = new Date().toISOString();

    const task: AcpTask = {
      id: taskId,
      status: 'pending',
      description: params.description,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(taskId, task);

    // Translate ACP context to bridge-compatible format
    const translationContext = this.translator.translateStartTask(params);
    this.contexts.set(taskId, translationContext);

    // Execute asynchronously — update task status as we go
    this.executeTask(taskId).catch(() => {
      // Error handling is done inside executeTask
    });

    return { task };
  }

  // ─── Send Message ────────────────────────────────────────────

  private async handleSendMessage(params: AcpSendMessageParams): Promise<AcpSendMessageResult> {
    this.ensureInitialized();

    const task = this.getTaskOrThrow(params.taskId);

    if (task.status === 'completed' || task.status === 'failed') {
      throw this.rpcError(
        ACP_ERROR_CODES.TASK_ALREADY_COMPLETED,
        `Task ${params.taskId} is already ${task.status}`,
      );
    }

    if (task.status === 'cancelled') {
      throw this.rpcError(
        ACP_ERROR_CODES.TASK_CANCELLED,
        `Task ${params.taskId} was cancelled`,
      );
    }

    // Append message to the translation context
    const existing = this.contexts.get(params.taskId);
    if (!existing) {
      throw this.rpcError(ACP_ERROR_CODES.INTERNAL_ERROR, 'Translation context lost');
    }

    const updated = this.translator.translateSendMessage(existing, params);
    this.contexts.set(params.taskId, updated);

    // Re-execute with updated context
    this.updateTaskStatus(params.taskId, 'pending');
    this.executeTask(params.taskId).catch(() => {
      // Error handling inside executeTask
    });

    return { task: this.tasks.get(params.taskId)! };
  }

  // ─── Cancel Task ─────────────────────────────────────────────

  private handleCancelTask(params: AcpCancelTaskParams): AcpCancelTaskResult {
    this.ensureInitialized();

    const task = this.getTaskOrThrow(params.taskId);

    if (task.status === 'completed' || task.status === 'failed') {
      throw this.rpcError(
        ACP_ERROR_CODES.TASK_ALREADY_COMPLETED,
        `Task ${params.taskId} is already ${task.status}`,
      );
    }

    this.updateTaskStatus(params.taskId, 'cancelled');

    return { task: this.tasks.get(params.taskId)! };
  }

  // ─── Get Task ────────────────────────────────────────────────

  private handleGetTask(params: AcpGetTaskParams): AcpGetTaskResult {
    this.ensureInitialized();
    const task = this.getTaskOrThrow(params.taskId);
    return { task };
  }

  // ─── List Tasks ──────────────────────────────────────────────

  private handleListTasks(params: AcpListTasksParams): AcpListTasksResult {
    this.ensureInitialized();

    let tasks = Array.from(this.tasks.values());

    if (params?.status) {
      tasks = tasks.filter((t) => t.status === params.status);
    }

    if (params?.limit && params.limit > 0) {
      tasks = tasks.slice(0, params.limit);
    }

    return { tasks };
  }

  // ─── Task Execution ──────────────────────────────────────────

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'cancelled') return;

    this.updateTaskStatus(taskId, 'running');
    this.emitProgress(taskId, 'Processing task...', 0);

    const context = this.contexts.get(taskId);
    if (!context) {
      this.failTask(taskId, 'CONTEXT_LOST', 'Translation context not found');
      return;
    }

    try {
      const generateParams = this.translator.buildGenerateRequest(context);
      this.emitProgress(taskId, 'Sending to LLM...', 50);

      const result = await this.generateHandler(generateParams);

      // Check if task was cancelled while we were waiting
      const current = this.tasks.get(taskId);
      if (!current || current.status === 'cancelled') return;

      this.emitProgress(taskId, 'Completed', 100);

      const updatedTask = {
        ...current,
        status: 'completed' as const,
        updatedAt: new Date().toISOString(),
        result: {
          content: result.text,
          metadata: {
            provider: result.provider,
            model: result.model,
          },
        },
      };

      this.tasks.set(taskId, updatedTask);
      this.emitTaskUpdate(updatedTask);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failTask(taskId, 'EXECUTION_ERROR', message);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw this.rpcError(
        ACP_ERROR_CODES.SERVER_NOT_INITIALIZED,
        'Server not initialized. Call acp/initialize first.',
      );
    }
  }

  private getTaskOrThrow(taskId: string): AcpTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw this.rpcError(ACP_ERROR_CODES.TASK_NOT_FOUND, `Task not found: ${taskId}`);
    }
    return task;
  }

  private updateTaskStatus(taskId: string, status: AcpTaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) {
      const updated = { ...task, status, updatedAt: new Date().toISOString() };
      this.tasks.set(taskId, updated);
      this.emitTaskUpdate(updated);
    }
  }

  private failTask(taskId: string, code: string, message: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      const updated: AcpTask = {
        ...task,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: { code, message },
      };
      this.tasks.set(taskId, updated);
      this.emitTaskUpdate(updated);
    }
  }

  private generateTaskId(): string {
    this.taskCounter += 1;
    return `acp-task-${this.taskCounter}`;
  }

  private countTasksByStatus(status: AcpTaskStatus): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === status) count++;
    }
    return count;
  }

  private evictOldTasks(): void {
    if (this.tasks.size < this.config.maxStoredTasks) return;

    // Sort by updatedAt, evict completed/failed tasks first
    const evictable = Array.from(this.tasks.values())
      .filter((t) => t.status === 'completed' || t.status === 'failed')
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

    for (const task of evictable) {
      if (this.tasks.size < this.config.maxStoredTasks) break;
      this.tasks.delete(task.id);
      this.contexts.delete(task.id);
    }
  }

  private emitProgress(taskId: string, message: string, percentage?: number): void {
    this.notificationHandler?.({ taskId, message, percentage });
  }

  private emitTaskUpdate(task: AcpTask): void {
    this.notificationHandler?.({ task });
  }

  private rpcError(code: number, message: string): { code: number; message: string } {
    return { code, message };
  }

  // ─── Test Helpers ──────────────────────────────────────────

  /** @internal — exposed for testing only */
  get taskCount(): number {
    return this.tasks.size;
  }

  /** @internal — exposed for testing only */
  getTask(taskId: string): AcpTask | undefined {
    return this.tasks.get(taskId);
  }
}
