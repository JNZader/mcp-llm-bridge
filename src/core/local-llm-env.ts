import {
  DEFAULT_LOCAL_LLM_CONFIG,
  type LocalLLMConfig,
} from '../local-llm/types.js';

type LocalLLMUrls = Pick<LocalLLMConfig, 'ollamaUrl' | 'lmStudioUrl'>;
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;
export type LocalLLMEnvConfig = Pick<
  LocalLLMConfig,
  'ollamaUrl' | 'lmStudioUrl' | 'connectionTimeoutMs' | 'requestTimeoutMs'
>;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_NODE_TIMER_DELAY_MS
    ? parsed
    : fallback;
}

export function getLocalLLMConfig(): LocalLLMEnvConfig {
  return {
    ollamaUrl: process.env['OLLAMA_URL'] ?? DEFAULT_LOCAL_LLM_CONFIG.ollamaUrl,
    lmStudioUrl: process.env['LM_STUDIO_URL'] ?? DEFAULT_LOCAL_LLM_CONFIG.lmStudioUrl,
    connectionTimeoutMs: parsePositiveInteger(
      process.env['LOCAL_LLM_CONNECTION_TIMEOUT_MS'],
      DEFAULT_LOCAL_LLM_CONFIG.connectionTimeoutMs,
    ),
    requestTimeoutMs: parsePositiveInteger(
      process.env['LOCAL_LLM_REQUEST_TIMEOUT_MS'],
      DEFAULT_LOCAL_LLM_CONFIG.requestTimeoutMs,
    ),
  };
}

export function getLocalLLMUrls(): LocalLLMUrls {
  const { ollamaUrl, lmStudioUrl } = getLocalLLMConfig();
  return { ollamaUrl, lmStudioUrl };
}

export function resolveHfToken(hfToken?: string): string | undefined {
  return hfToken ?? process.env['HF_TOKEN'];
}
