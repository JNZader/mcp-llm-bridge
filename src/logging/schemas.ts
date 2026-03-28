/**
 * Zod validation schemas for request logging
 * 
 * @module logging/schemas
 */

import { z } from 'zod';

/**
 * Schema for LogEntry
 */
export const LogEntrySchema = z.object({
  id: z.number().int().positive().optional(),
  timestamp: z.number().int().positive(),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
  attempts: z.number().int().positive().default(1),
  requestData: z.string().max(10000).optional(),
  responseData: z.string().max(10000).optional(),
  createdAt: z.number().int().positive().optional(),
});

/**
 * Schema for LogEntryPublic (API response)
 */
export const LogEntryPublicSchema = LogEntrySchema.pick({
  id: true,
  timestamp: true,
  provider: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  cost: true,
  latencyMs: true,
  error: true,
  attempts: true,
}).strict();

/**
 * Schema for LogQuery parameters
 */
export const LogQuerySchema = z.object({
  from: z.number().int().positive().optional(),
  to: z.number().int().positive().optional(),
  provider: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
}).refine(
  (data) => {
    if (data.from && data.to) {
      return data.to >= data.from;
    }
    return true;
  },
  {
    message: "'to' must be greater than or equal to 'from'",
    path: ['to'],
  }
);

/**
 * Schema for LogsResponse
 */
export const LogsResponseSchema = z.object({
  logs: z.array(LogEntryPublicSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

/**
 * Schema for LogContext
 */
export const LogContextSchema = z.object({
  startTime: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  requestId: z.string().uuid(),
});

/**
 * Schema for LogCaptureInput
 */
export const LogCaptureInputSchema = z.object({
  context: LogContextSchema,
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  error: z.instanceof(Error).optional(),
  attempts: z.number().int().positive(),
  requestData: z.unknown().optional(),
  responseData: z.unknown().optional(),
});

// Type inference from schemas
export type LogEntryValidated = z.infer<typeof LogEntrySchema>;
export type LogEntryPublicValidated = z.infer<typeof LogEntryPublicSchema>;
export type LogQueryValidated = z.infer<typeof LogQuerySchema>;
export type LogsResponseValidated = z.infer<typeof LogsResponseSchema>;
