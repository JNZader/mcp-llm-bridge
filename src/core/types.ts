/**
 * Core types for the LLM Gateway.
 *
 * These types define the contract for providers, requests, responses,
 * credential storage, and gateway configuration.
 */

import type { TaskClassification } from '../classification/index.js';

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
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  isAvailable(): Promise<boolean>;
}

export interface GenerateRequest {
  prompt: string;
  system?: string;
  provider?: string;
  model?: string;
  strict?: boolean;
  maxTokens?: number;
  project?: string;
  apiKeyId?: string;
  userId?: string;
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
  requestedProvider?: string;
  requestedModel?: string;
  resolvedProvider: string;
  resolvedModel: string;
  fallbackUsed: boolean;
  latencyMs?: number;
  sessionId?: string;
  routing?: RoutingMetadata;
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
