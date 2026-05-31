import type { LocalLLMConfig } from '../local-llm/types.js';

type LocalLLMUrls = Pick<LocalLLMConfig, 'ollamaUrl' | 'lmStudioUrl'>;

export function getLocalLLMUrls(): LocalLLMUrls {
  return {
    ollamaUrl: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
    lmStudioUrl: process.env['LM_STUDIO_URL'] ?? 'http://localhost:1234',
  };
}

export function resolveHfToken(hfToken?: string): string | undefined {
  return hfToken ?? process.env['HF_TOKEN'];
}
