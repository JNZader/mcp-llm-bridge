import { z } from 'zod';

const tokenCount = z.number().int().nonnegative();
const opaqueIdentifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
// Bounded metadata: rejects canaries (uppercase/unicode/oversized) without
// requiring registry membership — runtime providers/models are dynamic.
const boundedMetadata = z.string().regex(/^[a-z0-9_][a-z0-9_.:/-]{0,199}$/);
const safeFailureCode = z.enum(['rate_limited', 'timed_out', 'unavailable', 'failed']);

export const UsageTelemetrySchema = z.object({
  provider: boundedMetadata,
  keyName: opaqueIdentifier.optional(),
  model: boundedMetadata,
  project: opaqueIdentifier.optional(),
  apiKeyId: opaqueIdentifier.optional(),
  userId: opaqueIdentifier.optional(),
  tokensIn: tokenCount.optional(),
  tokensOut: tokenCount.optional(),
  totalTokens: tokenCount.optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  latencyMs: tokenCount,
  success: z.boolean(),
  attempt: z.number().int().positive().optional(),
  persistUnknownUsage: z.boolean().optional(),
  errorCode: safeFailureCode.optional(),
}).strict();

export const RequestLogTelemetrySchema = z.object({
  provider: boundedMetadata,
  model: boundedMetadata,
  correlationId: opaqueIdentifier.optional(),
  totalTokens: tokenCount.optional(),
  inputTokens: tokenCount.optional(),
  outputTokens: tokenCount.optional(),
  cost: z.number().nonnegative().optional(),
  latencyMs: tokenCount,
  errorCode: safeFailureCode.optional(),
  attempts: z.number().int().positive().optional(),
}).strict();

export function parseUsageTelemetryInput(value: unknown): z.infer<typeof UsageTelemetrySchema> {
  return UsageTelemetrySchema.parse(value);
}

export function parseRequestLogTelemetryInput(value: unknown): z.infer<typeof RequestLogTelemetrySchema> {
  return RequestLogTelemetrySchema.parse(value);
}
