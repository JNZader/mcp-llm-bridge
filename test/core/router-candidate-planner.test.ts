import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveCandidates } from '../../src/core/router-candidate-planner.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LLMProvider,
  ModelInfo,
  ProviderType,
} from '../../src/core/types.js';

function mockProvider(
  id: string,
  available = true,
  probes?: { isAvailable: string[] },
): LLMProvider {
  const models: ModelInfo[] = [
    { id: `${id}-model`, name: `${id} model`, provider: id, maxTokens: 4096 },
  ];
  return {
    id,
    name: id,
    type: 'cli' as ProviderType,
    models,
    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      return {
        text: id,
        provider: id,
        model: models[0]!.id,
        resolvedProvider: id,
        resolvedModel: models[0]!.id,
        fallbackUsed: false,
      };
    },
    async isAvailable(): Promise<boolean> {
      probes?.isAvailable.push(id);
      return available;
    },
  };
}

const CLI_FLEET = [
  'opencode-cli',
  'copilot-cli',
  'codex-cli',
  'qwen-cli',
  'antigravity-cli',
  'claude-cli',
] as const;

describe('resolveCandidates explicit provider pin', () => {
  const cases: Array<{
    name: string;
    request: GenerateRequest;
    available: readonly string[];
    expected: readonly string[];
  }> = [
    {
      name: "request.provider === 'opencode-cli' => candidate list length 1",
      request: { prompt: 'x', provider: 'opencode-cli', model: 'opencode-go/glm-5.3-flash' },
      available: CLI_FLEET,
      expected: ['opencode-cli'],
    },
    {
      name: 'explicit copilot-cli does not append the rest of the fleet',
      request: { prompt: 'x', provider: 'copilot-cli' },
      available: CLI_FLEET,
      expected: ['copilot-cli'],
    },
    {
      name: 'explicit provider that is unavailable does not fan out',
      request: { prompt: 'x', provider: 'opencode-cli' },
      available: ['copilot-cli', 'codex-cli', 'qwen-cli', 'antigravity-cli'],
      expected: [],
    },
    {
      name: 'omitted provider still returns every available adapter (model-based routing)',
      request: { prompt: 'x' },
      available: ['opencode-cli', 'copilot-cli', 'codex-cli'],
      expected: ['opencode-cli', 'copilot-cli', 'codex-cli'],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const providers = CLI_FLEET.map((id) =>
        mockProvider(id, testCase.available.includes(id)),
      );
      const candidates = await resolveCandidates(
        providers,
        testCase.request,
        (list) => list,
      );
      assert.deepEqual(
        candidates.map((provider) => provider.id),
        [...testCase.expected],
      );
    });
  }

  it('does not probe copilot/codex/qwen/agy availability when opencode-cli is pinned', async () => {
    const probes: { isAvailable: string[] } = { isAvailable: [] };
    const providers = CLI_FLEET.map((id) => mockProvider(id, true, probes));
    const candidates = await resolveCandidates(
      providers,
      { prompt: 'x', provider: 'opencode-cli' },
      (list) => list,
    );
    assert.deepEqual(candidates.map((provider) => provider.id), ['opencode-cli']);
    assert.deepEqual(probes.isAvailable, ['opencode-cli']);
  });
});
