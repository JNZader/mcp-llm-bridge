import { safeError, type SafeErrorCode } from './safe-error.js';

const SAFE_OPERATION_OUTCOME = {
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
} as const;

export type SafeOperationOutcome =
  (typeof SAFE_OPERATION_OUTCOME)[keyof typeof SAFE_OPERATION_OUTCOME];

export interface SafeOperation {
  code: SafeErrorCode;
  outcome: SafeOperationOutcome;
}

const OPERATION_CODE: Record<SafeOperationOutcome, SafeErrorCode> = {
  denied: 'ACCESS_DENIED',
  unavailable: 'NOT_AVAILABLE',
  failed: 'INTERNAL_ERROR',
};

/** Produces a fail-closed result that has no request, credential, or cause data. */
export function safeOperation(outcome: SafeOperationOutcome): SafeOperation {
  return { outcome, code: OPERATION_CODE[outcome] };
}

export function safeOperationError(operation: SafeOperation): ReturnType<typeof safeError> {
  return safeError(operation.code);
}
