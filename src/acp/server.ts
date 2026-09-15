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
  JsonRpcInputErrorResponse,
  JsonRpcRawResponse,
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
  AcpContext,
  AcpServerCapabilities,
  AcpProgressNotification,
  AcpTaskUpdateNotification,
} from './types.js';
import { ACP_METHODS, ACP_ERROR_CODES } from './types.js';
import { AcpToMcpTranslator, type TranslationContext } from './translator.js';
import { safeError } from '../core/safe-error.js';

type AcpErrorCode = (typeof ACP_ERROR_CODES)[keyof typeof ACP_ERROR_CODES];

interface PublicRpcError {
  readonly code: AcpErrorCode;
  readonly message: string;
}

const RPC_ERROR_MESSAGES: Readonly<Record<AcpErrorCode, string>> = Object.freeze({
  [ACP_ERROR_CODES.TASK_NOT_FOUND]: 'Task was not found.',
  [ACP_ERROR_CODES.TASK_ALREADY_COMPLETED]: 'Task is already completed.',
  [ACP_ERROR_CODES.TASK_CANCELLED]: 'Task was cancelled.',
  [ACP_ERROR_CODES.INVALID_TASK_STATE]: 'Task state is invalid.',
  [ACP_ERROR_CODES.SERVER_NOT_INITIALIZED]: 'Server is not initialized.',
  [ACP_ERROR_CODES.PARSE_ERROR]: 'Parse error.',
  [ACP_ERROR_CODES.INVALID_REQUEST]: 'Invalid request.',
  [ACP_ERROR_CODES.METHOD_NOT_FOUND]: 'Method was not found.',
  [ACP_ERROR_CODES.INVALID_PARAMS]: 'Invalid parameters.',
  [ACP_ERROR_CODES.INTERNAL_ERROR]: safeError('INTERNAL_ERROR').message,
});

const RAW_REQUEST_DECODE_KIND = {
  REQUEST: 'request',
  ERROR: 'error',
} as const;

type RawRequestDecodeResult =
  | { kind: typeof RAW_REQUEST_DECODE_KIND.REQUEST; request: JsonRpcRequest }
  | { kind: typeof RAW_REQUEST_DECODE_KIND.ERROR; response: JsonRpcInputErrorResponse };

function isRawRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRawJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRawRequestObject(value) || !Object.hasOwn(value, 'id')) {
    return false;
  }

  const id = value.id;
  return (
    (typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id))) &&
    value.jsonrpc === '2.0' &&
    typeof value.method === 'string' &&
    (value.params === undefined || isRawRequestObject(value.params))
  );
}

function rawInputError(
  id: string | number | null,
  code: typeof ACP_ERROR_CODES.PARSE_ERROR | typeof ACP_ERROR_CODES.INVALID_REQUEST | typeof ACP_ERROR_CODES.INVALID_PARAMS,
): JsonRpcInputErrorResponse {
  return { jsonrpc: '2.0', id, error: { code, message: RPC_ERROR_MESSAGES[code] } };
}

function decodeRawRequest(rawJson: string): RawRequestDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { kind: RAW_REQUEST_DECODE_KIND.ERROR, response: rawInputError(null, ACP_ERROR_CODES.PARSE_ERROR) };
  }

  if (!isRawRequestObject(parsed)) {
    return { kind: RAW_REQUEST_DECODE_KIND.ERROR, response: rawInputError(null, ACP_ERROR_CODES.INVALID_REQUEST) };
  }

  const id = parsed.id;
  if (!Object.hasOwn(parsed, 'id') || (typeof id !== 'string' && !(typeof id === 'number' && Number.isSafeInteger(id)))) {
    return { kind: RAW_REQUEST_DECODE_KIND.ERROR, response: rawInputError(null, ACP_ERROR_CODES.INVALID_REQUEST) };
  }

  if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    return { kind: RAW_REQUEST_DECODE_KIND.ERROR, response: rawInputError(id, ACP_ERROR_CODES.INVALID_REQUEST) };
  }

  if (parsed.params !== undefined && !isRawRequestObject(parsed.params)) {
    const code = Array.isArray(parsed.params) ? ACP_ERROR_CODES.INVALID_PARAMS : ACP_ERROR_CODES.INVALID_REQUEST;
    return { kind: RAW_REQUEST_DECODE_KIND.ERROR, response: rawInputError(id, code) };
  }

  if (!isRawJsonRpcRequest(parsed)) {
    return { kind: RAW_REQUEST_DECODE_KIND.ERROR, response: rawInputError(id, ACP_ERROR_CODES.INVALID_REQUEST) };
  }

  return { kind: RAW_REQUEST_DECODE_KIND.REQUEST, request: parsed };
}

const rpcErrorIdentities = new WeakMap<object, PublicRpcError>();

function projectRpcError(value: unknown): PublicRpcError {
  const captured = ((typeof value === 'object' && value !== null) || typeof value === 'function')
    ? rpcErrorIdentities.get(value) : undefined;
  return captured ?? {
    code: ACP_ERROR_CODES.INTERNAL_ERROR,
    message: RPC_ERROR_MESSAGES[ACP_ERROR_CODES.INTERNAL_ERROR],
  };
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isContextType(value: unknown): value is 'file' | 'snippet' | 'selection' {
  return value === 'file' || value === 'snippet' || value === 'selection';
}

function isContextRange(value: unknown): value is { start: number; end: number } {
  return (
    isObject(value) &&
    typeof value.start === 'number' &&
    typeof value.end === 'number'
  );
}

function isAcpContext(value: unknown): value is AcpContext {
  return (
    isObject(value) &&
    isContextType(value.type) &&
    isString(value.content) &&
    (value.path === undefined || isString(value.path)) &&
    (value.language === undefined || isString(value.language)) &&
    (value.range === undefined || isContextRange(value.range))
  );
}

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
      const publicError = projectRpcError(error);
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: publicError,
      };
    }
  }

  /**
   * Handle one raw JSON-RPC request string at the ACP typed-request boundary.
   * This is a single-request API, not a full JSON-RPC transport: batches,
   * notification-shaped inputs, framing, serialization, stdin and ports are unsupported.
   * String identifiers are recommended for large values; JSON duplicate keys retain native
   * JSON.parse last-key-wins behavior.
   */
  async handleRawRequest(rawJson: string): Promise<JsonRpcRawResponse> {
    const decoded = decodeRawRequest(rawJson);
    return decoded.kind === RAW_REQUEST_DECODE_KIND.ERROR
      ? decoded.response
      : this.handleRequest(decoded.request);
  }

  // ─── Method Dispatch ─────────────────────────────────────────

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case ACP_METHODS.INITIALIZE:
        return this.handleInitialize(this.parseInitializeParams(request.params));
      case ACP_METHODS.START_TASK:
        return this.handleStartTask(this.parseStartTaskParams(request.params));
      case ACP_METHODS.SEND_MESSAGE:
        return this.handleSendMessage(this.parseSendMessageParams(request.params));
      case ACP_METHODS.CANCEL_TASK:
        return this.handleCancelTask(this.parseCancelTaskParams(request.params));
      case ACP_METHODS.GET_TASK:
        return this.handleGetTask(this.parseGetTaskParams(request.params));
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
    } catch {
      this.failTask(taskId, 'EXECUTION_ERROR', safeError('INTERNAL_ERROR').message);
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

  private parseInitializeParams(params: JsonRpcRequest['params']): AcpInitializeParams {
    if (!isObject(params) || !isObject(params.clientCapabilities)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'clientCapabilities is required');
    }

    const { clientName, clientVersion } = params.clientCapabilities;
    if (!isString(clientName) || !isString(clientVersion)) {
      throw this.rpcError(
        ACP_ERROR_CODES.INVALID_PARAMS,
        'clientCapabilities.clientName and clientCapabilities.clientVersion are required',
      );
    }

    return {
      clientCapabilities: { clientName, clientVersion },
    };
  }

  private parseStartTaskParams(params: JsonRpcRequest['params']): AcpStartTaskParams {
    if (!isObject(params) || !isString(params.description)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'Task description is required');
    }

    if (params.context !== undefined) {
      if (!Array.isArray(params.context) || !params.context.every((value) => isAcpContext(value))) {
        throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'context must be a valid ACP context array');
      }
    }

    if (params.config !== undefined && !isObject(params.config)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'config must be an object');
    }

    return {
      description: params.description,
      context: params.context,
      config: params.config,
    };
  }

  private parseSendMessageParams(params: JsonRpcRequest['params']): AcpSendMessageParams {
    if (!isObject(params) || !isString(params.taskId) || !isString(params.content)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'taskId and content are required');
    }

    if (params.role !== undefined && params.role !== 'user' && params.role !== 'system') {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'role must be user or system');
    }

    return {
      taskId: params.taskId,
      content: params.content,
      role: params.role,
    };
  }

  private parseCancelTaskParams(params: JsonRpcRequest['params']): AcpCancelTaskParams {
    if (!isObject(params) || !isString(params.taskId)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'taskId is required');
    }

    if (params.reason !== undefined && !isString(params.reason)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'reason must be a string');
    }

    return {
      taskId: params.taskId,
      reason: params.reason,
    };
  }

  private parseGetTaskParams(params: JsonRpcRequest['params']): AcpGetTaskParams {
    if (!isObject(params) || !isString(params.taskId)) {
      throw this.rpcError(ACP_ERROR_CODES.INVALID_PARAMS, 'taskId is required');
    }

    return { taskId: params.taskId };
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

  private rpcError(code: AcpErrorCode, _message: string): PublicRpcError {
    const captured = Object.freeze({ code, message: RPC_ERROR_MESSAGES[code] });
    const error = { ...captured };
    rpcErrorIdentities.set(error, captured);
    return error;
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
