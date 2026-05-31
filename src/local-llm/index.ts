/**
 * Local LLM Offloading Module
 *
 * Offloads bounded tasks (boilerplate, commit messages, format conversion,
 * style checks) to a local LLM (Ollama/LM Studio) instead of Claude,
 * saving 86-95% tokens on deterministic tasks.
 *
 * Re-exports all local LLM types and implementations.
 */

// Types
export {
  DEFAULT_LOCAL_LLM_CONFIG,
  type LocalLLMBackend,
  type ConnectionStatus,
  type LocalModel,
  type DetectionResult,
  type TaskClassification,
  type LocalLLMResponse,
  type LocalLLMConfig,
} from './types.js';
export { type TaskType } from '../classification/index.js';

// Detection
export {
  detectLocalLLMs,
  getLocalLLMStatus,
  pickBestLocalModel,
  parseParameterSize,
} from './detector.js';

// Task routing
export {
  classifyForOffload,
  meetsOffloadThreshold,
} from './router.js';

// Client
export {
  callLocalLLM,
  pingBackend,
  LocalLLMError,
} from './client.js';
