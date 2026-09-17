import type { GenerateExecutionOptions } from './types.js';

export const GENERATION_CANCELLATION = {
  ABORT_CODE: 'ABORT_ERR',
  MESSAGE: 'Generation cancelled',
  NAME: 'AbortError',
} as const;

export interface GenerationAbortError extends Error {
  code: typeof GENERATION_CANCELLATION.ABORT_CODE;
}

export function createGenerationAbortError(): GenerationAbortError {
  const error = new Error(GENERATION_CANCELLATION.MESSAGE) as GenerationAbortError;
  error.name = GENERATION_CANCELLATION.NAME;
  error.code = GENERATION_CANCELLATION.ABORT_CODE;
  return error;
}

export function isGenerationAbortError(error: unknown): error is GenerationAbortError {
  return error instanceof Error && (
    error.name === GENERATION_CANCELLATION.NAME
    || (error as { code?: unknown }).code === GENERATION_CANCELLATION.ABORT_CODE
  );
}

export function throwIfGenerationAborted(options?: GenerateExecutionOptions): void {
  if (options?.signal?.aborted) {
    throw createGenerationAbortError();
  }
}
