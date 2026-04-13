/**
 * ACP (Agent Client Protocol) Type Definitions
 *
 * Based on the Agent Client Protocol specification:
 * https://github.com/agentclientprotocol/agent-client-protocol
 *
 * ACP standardizes communication between code editors (clients)
 * and coding agents (servers). The bridge acts as an ACP server,
 * translating ACP requests into MCP tool calls.
 */

// ─── JSON-RPC Base ────────────────────────────────────────────

export interface JsonRpcMessage {
  jsonrpc: '2.0';
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse extends JsonRpcMessage {
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── ACP Capabilities ────────────────────────────────────────

export interface AcpServerCapabilities {
  /** Supported ACP protocol version */
  protocolVersion: string;
  /** Server name identifier */
  serverName: string;
  /** Server version */
  serverVersion: string;
  /** Features this server supports */
  features: AcpFeature[];
}

export type AcpFeature =
  | 'tasks'
  | 'messages'
  | 'cancellation'
  | 'progress';

export interface AcpClientCapabilities {
  /** Client name (e.g., "vscode", "cursor") */
  clientName: string;
  /** Client version */
  clientVersion: string;
}

// ─── ACP Initialize ──────────────────────────────────────────

export interface AcpInitializeParams {
  /** Client capabilities and identification */
  clientCapabilities: AcpClientCapabilities;
}

export interface AcpInitializeResult {
  /** Server capabilities and identification */
  serverCapabilities: AcpServerCapabilities;
}

// ─── ACP Tasks ───────────────────────────────────────────────

export type AcpTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AcpTask {
  /** Unique task identifier */
  id: string;
  /** Current task status */
  status: AcpTaskStatus;
  /** Task description provided by the editor */
  description: string;
  /** Timestamp when the task was created */
  createdAt: string;
  /** Timestamp of last status update */
  updatedAt: string;
  /** Final result when status is 'completed' */
  result?: AcpTaskResult;
  /** Error details when status is 'failed' */
  error?: AcpTaskError;
}

export interface AcpTaskResult {
  /** Text output from the agent */
  content: string;
  /** Tool calls that were executed */
  toolCalls?: AcpToolCallRecord[];
  /** Metadata about execution */
  metadata?: Record<string, unknown>;
}

export interface AcpTaskError {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: unknown;
}

export interface AcpToolCallRecord {
  /** Tool name that was called */
  toolName: string;
  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
  /** Tool execution result */
  result?: unknown;
}

// ─── ACP Method Params ───────────────────────────────────────

export interface AcpStartTaskParams {
  /** Human-readable task description */
  description: string;
  /** Optional context files or snippets */
  context?: AcpContext[];
  /** Optional configuration overrides */
  config?: Record<string, unknown>;
}

export interface AcpContext {
  /** Type of context (file, snippet, selection) */
  type: 'file' | 'snippet' | 'selection';
  /** File path (for file/selection types) */
  path?: string;
  /** Content of the context */
  content: string;
  /** Language identifier */
  language?: string;
  /** Line range for selections */
  range?: { start: number; end: number };
}

export interface AcpStartTaskResult {
  /** The created task */
  task: AcpTask;
}

export interface AcpSendMessageParams {
  /** Task ID to send the message to */
  taskId: string;
  /** Message content */
  content: string;
  /** Optional role (defaults to 'user') */
  role?: 'user' | 'system';
}

export interface AcpSendMessageResult {
  /** Updated task after processing the message */
  task: AcpTask;
}

export interface AcpCancelTaskParams {
  /** Task ID to cancel */
  taskId: string;
  /** Optional reason for cancellation */
  reason?: string;
}

export interface AcpCancelTaskResult {
  /** Updated task after cancellation */
  task: AcpTask;
}

export interface AcpGetTaskParams {
  /** Task ID to retrieve */
  taskId: string;
}

export interface AcpGetTaskResult {
  /** The requested task */
  task: AcpTask;
}

export interface AcpListTasksParams {
  /** Optional status filter */
  status?: AcpTaskStatus;
  /** Maximum number of tasks to return */
  limit?: number;
}

export interface AcpListTasksResult {
  /** List of tasks */
  tasks: AcpTask[];
}

// ─── ACP Notifications (server → client) ─────────────────────

export interface AcpProgressNotification {
  /** Task ID */
  taskId: string;
  /** Progress message */
  message: string;
  /** Optional numeric progress (0-100) */
  percentage?: number;
}

export interface AcpTaskUpdateNotification {
  /** Updated task */
  task: AcpTask;
}

// ─── ACP Method Names ────────────────────────────────────────

export const ACP_METHODS = {
  INITIALIZE: 'acp/initialize',
  START_TASK: 'acp/startTask',
  SEND_MESSAGE: 'acp/sendMessage',
  CANCEL_TASK: 'acp/cancelTask',
  GET_TASK: 'acp/getTask',
  LIST_TASKS: 'acp/listTasks',
} as const;

export const ACP_NOTIFICATIONS = {
  PROGRESS: 'acp/progress',
  TASK_UPDATE: 'acp/taskUpdate',
} as const;

// ─── ACP Error Codes ─────────────────────────────────────────

export const ACP_ERROR_CODES = {
  TASK_NOT_FOUND: -32001,
  TASK_ALREADY_COMPLETED: -32002,
  TASK_CANCELLED: -32003,
  INVALID_TASK_STATE: -32004,
  SERVER_NOT_INITIALIZED: -32005,
  // Standard JSON-RPC errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
