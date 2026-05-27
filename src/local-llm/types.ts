/**
 * Local LLM offloading — types and interfaces.
 *
 * Defines the contract for local LLM detection, task classification,
 * and offloading bounded tasks to Ollama/LM Studio instead of
 * remote providers, saving 86-95% tokens on boilerplate tasks.
 */

/** Supported local LLM runtime backends. */
export type LocalLLMBackend = 'ollama' | 'lm-studio';

/** Connection status for a local LLM runtime. */
export type ConnectionStatus = 'connected' | 'disconnected' | 'error';

import type { TaskType } from '../classification/index.js';

/**
 * A detected local LLM model available for offloading.
 */
export interface LocalModel {
  /** Model identifier (e.g., "llama3.2:3b", "codellama:7b"). */
  id: string;
  /** Display name. */
  name: string;
  /** Backend runtime hosting this model. */
  backend: LocalLLMBackend;
  /** Parameter count in billions (if known). */
  parameterSize?: number;
  /** Context window in tokens (if known). */
  contextWindow?: number;
  /** Whether this model is currently loaded/warm. */
  loaded: boolean;
}

/**
 * Detection result from probing a local LLM runtime.
 */
export interface DetectionResult {
  /** Backend that was probed. */
  backend: LocalLLMBackend;
  /** Whether the runtime is reachable. */
  status: ConnectionStatus;
  /** Base URL used for the connection. */
  baseUrl: string;
  /** Models available on this runtime. */
  models: LocalModel[];
  /** Error message if detection failed. */
  error?: string;
}

/**
 * Task classification result with offloading recommendation.
 */
export interface TaskClassification {
  /** Detected task type. */
  task: TaskType;
  /** Confidence score 0-1. */
  confidence: number;
  /** Whether this task should be offloaded to a local LLM. */
  shouldOffload: boolean;
  /** Reason for the decision. */
  reason: string;
}

/**
 * Response from a local LLM call.
 */
export interface LocalLLMResponse {
  /** Generated text. */
  text: string;
  /** Model that handled the request. */
  model: string;
  /** Backend runtime used. */
  backend: LocalLLMBackend;
  /** Latency in milliseconds. */
  latencyMs: number;
  /** Estimated tokens used. */
  tokensUsed?: number;
}

/**
 * Configuration for the local LLM offloading system.
 */
export interface LocalLLMConfig {
  /** Whether offloading is enabled. */
  enabled: boolean;
  /** Ollama base URL (default: http://localhost:11434). */
  ollamaUrl: string;
  /** LM Studio base URL (default: http://localhost:1234). */
  lmStudioUrl: string;
  /** Preferred model ID for offloaded tasks (auto-detect if not set). */
  preferredModel?: string;
  /** Connection timeout in ms (default: 3000). */
  connectionTimeoutMs: number;
  /** Request timeout in ms (default: 30000). */
  requestTimeoutMs: number;
  /** Minimum confidence to offload (default: 0.7). */
  minOffloadConfidence: number;
}

/** Default local LLM configuration. */
export const DEFAULT_LOCAL_LLM_CONFIG: LocalLLMConfig = {
  enabled: true,
  ollamaUrl: 'http://localhost:11434',
  lmStudioUrl: 'http://localhost:1234',
  connectionTimeoutMs: 3000,
  requestTimeoutMs: 30000,
  minOffloadConfidence: 0.7,
};
