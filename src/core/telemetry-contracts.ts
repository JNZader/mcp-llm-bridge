import { z } from 'zod';

import {
  isRegisteredTelemetryModel,
  isRegisteredTelemetryProvider,
} from './provider-registry.js';

const tokenCount = z.number().int().nonnegative();
const opaqueIdentifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const registeredProvider = z.string().refine(isRegisteredTelemetryProvider, 'Unknown telemetry provider');
const registeredModel = z.string().refine(isRegisteredTelemetryModel, 'Unknown telemetry model');
const safeFailureCode = z.enum(['rate_limited', 'timed_out', 'unavailable', 'failed']);

export const UsageTelemetrySchema = z.object({
  provider: registeredProvider,
  keyName: opaqueIdentifier.optional(),
  model: registeredModel,
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
  provider: registeredProvider,
  model: registeredModel,
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
