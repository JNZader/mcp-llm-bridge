/**
 * Core types for the LLM Gateway.
 *
 * These types define the contract for providers, requests, responses,
 * credential storage, and gateway configuration.
 */

import type { TaskClassification } from '../classification/index.js';
import type { ResponseFormat, RoutingMode } from './schemas.js';

export type ProviderType = 'api' | 'cli';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
}

export interface LLMProvider {
  id: string;
  name: string;
  type: ProviderType;
  models: ModelInfo[];
  generate(request: GenerateRequest, options?: GenerateExecutionOptions): Promise<GenerateResponse>;
  isAvailable(): Promise<boolean>;
}

export interface GenerateExecutionOptions {
  signal?: AbortSignal;
}

export interface GenerateRequest {
  prompt: string;
  system?: string;
  provider?: string;
  requireProvider?: boolean;
  model?: string;
  strict?: boolean;
  routingMode?: RoutingMode;
  responseFormat?: ResponseFormat;
  maxTokens?: number;
  project?: string;
  apiKeyId?: string;
  userId?: string;
  tools?: 'none';
  /** Internal planning hint: skip these providers while resolving candidates. */
  excludeProviders?: string[];
}

export interface ToolEvidence {
  status: 'complete';
  mode: 'none';
  source: 'opencode-json-events';
  toolCallCount: number;
  enforcement: 'temporary-opencode-agent-config';
  observable: true;
}

const TOOL_EVIDENCE_KEYS = [
  'status',
  'mode',
  'source',
  'toolCallCount',
  'enforcement',
  'observable',
] as const;

/**
 * Projects only strict local no-tools evidence into the public response.
 * Provider metadata is not evidence unless it satisfies this complete shape.
 */
export function readToolEvidence(value: unknown): ToolEvidence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== TOOL_EVIDENCE_KEYS.length || !TOOL_EVIDENCE_KEYS.every((key) => keys.includes(key))) {
    return undefined;
  }
  if (
    record['status'] !== 'complete' ||
    record['mode'] !== 'none' ||
    record['source'] !== 'opencode-json-events' ||
    record['enforcement'] !== 'temporary-opencode-agent-config' ||
    record['observable'] !== true ||
    typeof record['toolCallCount'] !== 'number' ||
    !Number.isSafeInteger(record['toolCallCount']) ||
    record['toolCallCount'] !== 0
  ) {
    return undefined;
  }

  return {
    status: 'complete',
    mode: 'none',
    source: 'opencode-json-events',
    toolCallCount: 0,
    enforcement: 'temporary-opencode-agent-config',
    observable: true,
  };
}

export const USAGE_PROVENANCE_STATUS = {
  REPORTED: 'reported',
  PARTIAL: 'partial',
  UNKNOWN: 'unknown',
} as const;

export type UsageProvenanceStatus = (typeof USAGE_PROVENANCE_STATUS)[keyof typeof USAGE_PROVENANCE_STATUS];

export const USAGE_PROVENANCE_REASON = {
  ABSENT: 'absent',
  INVALID: 'invalid',
  MULTIPLE_EVENTS: 'multiple-events',
  OVERFLOW: 'overflow',
} as const;

export type UsageProvenanceUnknownReason = (typeof USAGE_PROVENANCE_REASON)[keyof typeof USAGE_PROVENANCE_REASON];

export interface ReportedUsageProvenance {
  status: typeof USAGE_PROVENANCE_STATUS.REPORTED;
  origin: 'cli-output';
  eventCount: 1;
  inputTokens: number;
  outputTokens: number;
}

export type PartialUsageProvenance =
  | {
    status: typeof USAGE_PROVENANCE_STATUS.PARTIAL;
    origin: 'cli-output';
    eventCount: 1;
    inputTokens: number;
    outputTokens?: never;
  }
  | {
    status: typeof USAGE_PROVENANCE_STATUS.PARTIAL;
    origin: 'cli-output';
    eventCount: 1;
    outputTokens: number;
    inputTokens?: never;
  };

export interface UnknownUsageProvenance {
  status: typeof USAGE_PROVENANCE_STATUS.UNKNOWN;
  reason: UsageProvenanceUnknownReason;
}

interface UsageProvenanceByStatus {
  reported: ReportedUsageProvenance;
  partial: PartialUsageProvenance;
  unknown: UnknownUsageProvenance;
}

export type UsageProvenance = UsageProvenanceByStatus[UsageProvenanceStatus];

/** Catalog-derived estimate; this is not provider billing or charge attestation. */
export interface CostEvidence {
  status: 'estimated_zero';
  source: 'catalog_estimate';
  estimatedCost: 0;
  currency: 'USD';
  inputTokens: number;
  outputTokens: number;
  providerChargeAttestation: false;
  caveat: 'Estimated from gateway model-price metadata; not provider charge attestation.';
}

export const GENERATE_COMPLETE_STOP = {
  STOP: 'stop',
  END_TURN: 'end_turn',
  STOP_SEQUENCE: 'stop_sequence',
  EOS: 'eos',
} as const;

export type GenerateCompleteStop =
  (typeof GENERATE_COMPLETE_STOP)[keyof typeof GENERATE_COMPLETE_STOP];

/** Consorcio treats these as truncated (allowed, regeneration path, not transport retry). */
export const GENERATE_LENGTH_STOP = {
  LENGTH: 'length',
  MAX_TOKENS: 'max_tokens',
  MAX_OUTPUT_TOKENS: 'max_output_tokens',
} as const;

export interface GenerateResponse {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
  /** Optional transport metadata; omission means token usage is unknown. */
  usageProvenance?: UsageProvenance;
  /** Optional explicit zero-cost estimate; omission means cost is not established. */
  costEvidence?: CostEvidence;
  requestedProvider?: string;
  requestedModel?: string;
  resolvedProvider: string;
  resolvedModel: string;
  fallbackUsed: boolean;
  latencyMs?: number;
  sessionId?: string;
  routing?: RoutingMetadata;
  toolEvidence?: ToolEvidence;
  /** Consumer stop reason. Consorcio reads stop_reason | finish_reason | stop. */
  stop_reason?: string;
  finish_reason?: string;
  stop?: string;
}

export interface RoutingMetadata {
  strategy: string;
  classification?: TaskClassification;
  matchedRuleId?: string;
  selectedEndpointId?: string;
  attemptedProviders: string[];
  fallbackFrom?: string;
  fallbackTo?: string;
  decisionReason?: string;
}

export interface StoredCredential {
  id: number;
  provider: string;
  keyName: string;
  project: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaskedCredential extends StoredCredential {
  maskedValue: string;
}

export interface StoredFile {
  id: number;
  provider: string;
  fileName: string;
  project: string;
  createdAt: string;
}

export type TrustLevel = 'local-dev' | 'restricted' | 'open';

export interface GatewayConfig {
  masterKey: Buffer;
  dbPath: string;
  httpPort: number;
  project?: string;
  authToken?: string;
  securityProfile?: TrustLevel;
}
