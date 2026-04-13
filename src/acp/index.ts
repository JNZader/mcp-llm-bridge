/**
 * ACP (Agent Client Protocol) Module
 *
 * Provides ACP transport for the bridge, enabling code editors
 * to communicate with the LLM pipeline using the Agent Client Protocol.
 *
 * @see https://github.com/agentclientprotocol/agent-client-protocol
 */

// Types
export type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  AcpServerCapabilities,
  AcpClientCapabilities,
  AcpFeature,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpTask,
  AcpTaskStatus,
  AcpTaskResult,
  AcpTaskError,
  AcpToolCallRecord,
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
  AcpContext,
  AcpProgressNotification,
  AcpTaskUpdateNotification,
} from './types.js';

export { ACP_METHODS, ACP_NOTIFICATIONS, ACP_ERROR_CODES } from './types.js';

// Server
export { AcpServer } from './server.js';
export type { GenerateHandler, NotificationHandler, AcpServerConfig } from './server.js';

// Translator
export { AcpToMcpTranslator } from './translator.js';
export type {
  McpToolCallRequest,
  McpToolCallResult,
  McpContentBlock,
  TranslationContext,
} from './translator.js';
