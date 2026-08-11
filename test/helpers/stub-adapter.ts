/**
 * Deterministic stub LLM provider for tests.
 *
 * The real adapters returned by `createAllAdapters` only report as available
 * when live provider credentials/CLIs are configured. In a credential-less CI
 * that makes `router.getAvailableModels()` (and therefore `/v1/models`) return
 * an empty list, which is correct runtime behavior but breaks tests that assert
 * the endpoint shape and wiring.
 *
 * Registering this always-available stub lets those tests verify the SHAPE of
 * the models list deterministically, without depending on real credentials.
 */

import type {
  LLMProvider,
  ModelInfo,
  GenerateRequest,
  GenerateResponse,
} from '../../src/core/types.js';

export const STUB_PROVIDER_ID = 'stub';

const STUB_MODEL: ModelInfo = {
  id: 'stub-model-1',
  name: 'Stub Model 1',
  provider: STUB_PROVIDER_ID,
  maxTokens: 4096,
};

export class StubAdapter implements LLMProvider {
  readonly id = STUB_PROVIDER_ID;
  readonly name = 'Stub Provider';
  readonly type = 'api' as const;
  readonly models: ModelInfo[] = [STUB_MODEL];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return {
      text: `stub response for: ${request.prompt}`,
      provider: this.id,
      model: STUB_MODEL.id,
      resolvedProvider: this.id,
      resolvedModel: STUB_MODEL.id,
      fallbackUsed: false,
    };
  }
}
