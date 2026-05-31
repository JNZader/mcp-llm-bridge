import type { LLMProvider } from './types.js';

export interface RouterAttemptResult<T> {
  result: T;
  provider: LLMProvider;
  index: number;
}

export interface ProviderErrorAccumulator {
  errors: string[];
  add: (provider: LLMProvider, error: unknown) => void;
}

export function createProviderErrorAccumulator(): ProviderErrorAccumulator {
  const errors: string[] = [];

  return {
    errors,
    add(provider, error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.id}: ${message}`);
    },
  };
}

export async function tryCandidates<T>(
  candidates: LLMProvider[],
  attempt: (provider: LLMProvider, index: number) => Promise<T>,
  onError: (provider: LLMProvider, error: unknown, index: number) => void,
): Promise<RouterAttemptResult<T> | null> {
  for (const [index, provider] of candidates.entries()) {
    try {
      return {
        result: await attempt(provider, index),
        provider,
        index,
      };
    } catch (error) {
      onError(provider, error, index);
    }
  }

  return null;
}

export function throwAllProvidersFailed(errors: string[]): never {
  throw new Error(
    `All providers failed. Store credentials via vault_store or install a CLI tool.\n${errors.join('\n')}`,
  );
}
