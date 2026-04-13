/**
 * Local LLM client — call Ollama or LM Studio for offloaded tasks.
 *
 * Both Ollama and LM Studio expose OpenAI-compatible endpoints,
 * so we use a single HTTP client with backend-specific URL resolution.
 * Graceful degradation: if the local LLM is unreachable, the caller
 * falls back to the primary provider transparently.
 */

import type {
  LocalLLMBackend,
  LocalLLMConfig,
  LocalLLMResponse,
  LocalModel,
} from './types.js';
import { DEFAULT_LOCAL_LLM_CONFIG } from './types.js';

/**
 * Error thrown when a local LLM request fails.
 * Callers should catch this and fall back to the primary provider.
 */
export class LocalLLMError extends Error {
  constructor(
    message: string,
    readonly backend: LocalLLMBackend,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LocalLLMError';
  }
}

/**
 * Build the chat completions URL for a given backend.
 */
function buildCompletionUrl(backend: LocalLLMBackend, config: LocalLLMConfig): string {
  const baseUrl = backend === 'ollama' ? config.ollamaUrl : config.lmStudioUrl;
  // Both backends support OpenAI-compatible /v1/chat/completions
  return `${baseUrl}/v1/chat/completions`;
}

/**
 * OpenAI-compatible chat completion response shape (minimal).
 */
interface ChatCompletionResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Send a prompt to a local LLM model.
 *
 * Uses the OpenAI-compatible chat completions endpoint that both
 * Ollama and LM Studio support.
 *
 * @throws LocalLLMError if the request fails (caller should fall back)
 */
export async function callLocalLLM(
  model: LocalModel,
  prompt: string,
  system?: string,
  config?: Partial<LocalLLMConfig>,
): Promise<LocalLLMResponse> {
  const cfg = { ...DEFAULT_LOCAL_LLM_CONFIG, ...config };
  const url = buildCompletionUrl(model.backend, cfg);
  const startTime = Date.now();

  const messages: Array<{ role: string; content: string }> = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        messages,
        temperature: 0.3, // low temperature for deterministic tasks
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new LocalLLMError(
        `HTTP ${response.status}: ${errorText}`,
        model.backend,
      );
    }

    const body = await response.json() as ChatCompletionResponse;
    const latencyMs = Date.now() - startTime;

    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new LocalLLMError('Empty response from local LLM', model.backend);
    }

    return {
      text,
      model: model.id,
      backend: model.backend,
      latencyMs,
      tokensUsed: body.usage?.total_tokens,
    };
  } catch (error) {
    if (error instanceof LocalLLMError) throw error;

    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes('abort');

    throw new LocalLLMError(
      isTimeout ? 'Request timed out' : `Request failed: ${message}`,
      model.backend,
      error,
    );
  }
}

/**
 * Check if a local LLM backend is reachable with a lightweight ping.
 */
export async function pingBackend(
  backend: LocalLLMBackend,
  config?: Partial<LocalLLMConfig>,
): Promise<boolean> {
  const cfg = { ...DEFAULT_LOCAL_LLM_CONFIG, ...config };
  const baseUrl = backend === 'ollama' ? cfg.ollamaUrl : cfg.lmStudioUrl;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.connectionTimeoutMs);

    // Ollama: GET / returns "Ollama is running"
    // LM Studio: GET /v1/models returns model list
    const endpoint = backend === 'ollama' ? baseUrl : `${baseUrl}/v1/models`;
    const response = await fetch(endpoint, { signal: controller.signal });

    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}
