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
