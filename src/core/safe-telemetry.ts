import type { SafeErrorCode } from './safe-error.js';
import type { SafeOperationOutcome } from './safe-operation.js';

export interface SafeTelemetryInput {
  event: string;
  operation: string;
  outcome: SafeOperationOutcome;
  code?: SafeErrorCode;
  durationMs?: number;
}

export interface SafeTelemetry {
  event: string;
  operation: string;
  outcome: SafeOperationOutcome;
  code?: SafeErrorCode;
  durationMs?: number;
}

/**
 * Creates the only telemetry payload safe for persistence. Its closed input
 * shape intentionally has no prompt, response, credential, error, or context.
 */
export function safeTelemetry(input: SafeTelemetryInput): SafeTelemetry {
  return {
    event: input.event,
    operation: input.operation,
    outcome: input.outcome,
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
  };
}
