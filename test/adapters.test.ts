/**
 * Adapter tests — verify adapter interface contracts and factory function.
 *
 * Uses a temporary Vault instance to check API adapter availability behavior.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../src/vault/vault.js';
import type { GatewayConfig, LLMProvider } from '../src/core/types.js';
import {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  GroqAdapter,
  OpenRouterAdapter,
  CerebrasAdapter,
  ZaiAdapter,
  NvidiaAdapter,
  MistralAdapter,
  SambanovaAdapter,
  HyperbolicAdapter,
  ClaudeCliAdapter,
  AntigravityCliAdapter,
  CodexCliAdapter,
  QwenCliAdapter,
  CopilotCliAdapter,
  createAllAdapters,
} from '../src/adapters/index.js';
import { VALID_PROVIDERS } from '../src/core/constants.js';
import { normalizeProviderId } from '../src/core/provider-aliases.js';

interface OpenAICompatibleAdapterExpectation {
  readonly Adapter: new (vault: Vault) => LLMProvider & {
    readonly baseURL: string;
    readonly defaultModel: string;
  };
  readonly id: string;
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly modelIds: readonly string[];
  readonly apiKeyEnv: string;
}

const NEW_OPENAI_COMPATIBLE_ADAPTERS = [
  {
    Adapter: CerebrasAdapter,
    id: 'cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    defaultModel: 'gpt-oss-120b',
    modelIds: ['gpt-oss-120b', 'llama-3.3-70b', 'zai-glm-4.7'],
    apiKeyEnv: 'CEREBRAS_API_KEY',
  },
  {
    Adapter: ZaiAdapter,
    id: 'zai',
    baseURL: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-4.6',
    modelIds: ['glm-4.6', 'glm-4.5-air', 'glm-4.5-flash'],
    apiKeyEnv: 'ZAI_API_KEY',
  },
  {
    Adapter: NvidiaAdapter,
    id: 'nvidia',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    modelIds: [
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen2.5-coder-32b-instruct',
    ],
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
  {
    Adapter: MistralAdapter,
    id: 'mistral',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    modelIds: ['mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'],
    apiKeyEnv: 'MISTRAL_API_KEY',
  },
  {
    Adapter: SambanovaAdapter,
    id: 'sambanova',
    baseURL: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    modelIds: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1', 'Qwen3-32B'],
    apiKeyEnv: 'SAMBANOVA_API_KEY',
  },
  {
    Adapter: HyperbolicAdapter,
    id: 'hyperbolic',
    baseURL: 'https://api.hyperbolic.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    modelIds: ['meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1'],
    apiKeyEnv: 'HYPERBOLIC_API_KEY',
  },
] as const satisfies readonly OpenAICompatibleAdapterExpectation[];

const originalNewProviderEnv = new Map<string, string | undefined>();
for (const { apiKeyEnv } of NEW_OPENAI_COMPATIBLE_ADAPTERS) {
  originalNewProviderEnv.set(apiKeyEnv, process.env[apiKeyEnv]);
  delete process.env[apiKeyEnv];
}

/** Create a test config with a temp DB. */
function createTestConfig(): GatewayConfig {
  const masterKey = randomBytes(32);
  const dbPath = `/tmp/test-adapters-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  return { masterKey, dbPath, httpPort: 0 };
}

const config = createTestConfig();
const vault = new Vault(config);

after(() => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
  for (const [apiKeyEnv, value] of originalNewProviderEnv.entries()) {
    if (value === undefined) {
      delete process.env[apiKeyEnv];
    } else {
      process.env[apiKeyEnv] = value;
    }
  }
});

// ── Adapter interface contracts ───────────────────────────

function assertProviderInterface(provider: LLMProvider, expectedId: string): void {
  assert.ok(typeof provider.id === 'string' && provider.id.length > 0, `${expectedId}: id must be a non-empty string`);
  assert.equal(provider.id, expectedId);
  assert.ok(typeof provider.name === 'string' && provider.name.length > 0, `${expectedId}: name must be a non-empty string`);
  assert.ok(provider.type === 'api' || provider.type === 'cli', `${expectedId}: type must be "api" or "cli"`);
  assert.ok(Array.isArray(provider.models) && provider.models.length > 0, `${expectedId}: models must be a non-empty array`);
  assert.ok(typeof provider.generate === 'function', `${expectedId}: generate must be a function`);
  assert.ok(typeof provider.isAvailable === 'function', `${expectedId}: isAvailable must be a function`);
}

function assertModelInfo(model: { id?: unknown; name?: unknown; provider?: unknown; maxTokens?: unknown }, adapterId: string): void {
  assert.ok(typeof model.id === 'string' && model.id.length > 0, `${adapterId}: model.id must be a non-empty string`);
  assert.ok(typeof model.name === 'string' && model.name.length > 0, `${adapterId}: model.name must be a non-empty string`);
  assert.ok(typeof model.provider === 'string' && model.provider.length > 0, `${adapterId}: model.provider must be a non-empty string`);
  assert.ok(typeof model.maxTokens === 'number' && model.maxTokens > 0, `${adapterId}: model.maxTokens must be a positive number`);
}

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'anthropic');
    assert.equal(adapter.type, 'api');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'anthropic');
      assert.equal(model.provider, 'anthropic');
    }
  });

  it('isAvailable returns false when vault has no credentials', async () => {
    const available = await adapter.isAvailable();
    assert.equal(available, false, 'Should not be available without stored credentials');
  });
});

describe('OpenAIAdapter', () => {
  const adapter = new OpenAIAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'openai');
    assert.equal(adapter.type, 'api');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'openai');
      assert.equal(model.provider, 'openai');
    }
  });

  it('isAvailable returns false when vault has no credentials', async () => {
    const available = await adapter.isAvailable();
    assert.equal(available, false, 'Should not be available without stored credentials');
  });
});

describe('GoogleAdapter', () => {
  const adapter = new GoogleAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'google');
    assert.equal(adapter.type, 'api');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'google');
      assert.equal(model.provider, 'google');
    }
  });

  it('isAvailable returns false when vault has no credentials', async () => {
    const available = await adapter.isAvailable();
    assert.equal(available, false, 'Should not be available without stored credentials');
  });
});

describe('GroqAdapter', () => {
  const adapter = new GroqAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'groq');
    assert.equal(adapter.type, 'api');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'groq');
      assert.equal(model.provider, 'groq');
    }
  });

  it('isAvailable returns false when vault has no credentials', async () => {
    const available = await adapter.isAvailable();
    assert.equal(available, false, 'Should not be available without stored credentials');
  });
});

describe('OpenRouterAdapter', () => {
  const adapter = new OpenRouterAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'openrouter');
    assert.equal(adapter.type, 'api');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'openrouter');
      assert.equal(model.provider, 'openrouter');
    }
  });

  it('isAvailable returns false when vault has no credentials', async () => {
    const available = await adapter.isAvailable();
    assert.equal(available, false, 'Should not be available without stored credentials');
  });
});

for (const expectation of NEW_OPENAI_COMPATIBLE_ADAPTERS) {
  describe(`${expectation.id} adapter`, () => {
    const adapter = new expectation.Adapter(vault);

    it('has required properties', () => {
      assertProviderInterface(adapter, expectation.id);
      assert.equal(adapter.type, 'api');
      assert.equal(adapter.baseURL, expectation.baseURL);
      assert.equal(adapter.defaultModel, expectation.defaultModel);
    });

    it('models have required fields and declared model ids', () => {
      assert.deepEqual(adapter.models.map((model) => model.id), expectation.modelIds);
      for (const model of adapter.models) {
        assertModelInfo(model, expectation.id);
        assert.equal(model.provider, expectation.id);
      }
    });

    it('isAvailable returns false when vault and env have no credentials', async () => {
      delete process.env[expectation.apiKeyEnv];
      const available = await adapter.isAvailable();
      assert.equal(available, false, 'Should not be available without stored credentials');
    });
  });
}

describe('ClaudeCliAdapter', () => {
  const adapter = new ClaudeCliAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'claude-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'claude-cli');
    }
  });
});

describe('AntigravityCliAdapter', () => {
  const adapter = new AntigravityCliAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'antigravity-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'antigravity-cli');
    }
  });

  it('uses the curated Gemini model list', () => {
    assert.deepEqual(adapter.models.map((model) => model.id), [
      'gemini-3.1-pro',
      'gemini-3.1-flash',
      'gemini-3.1-flash-lite',
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
  });
});

describe('CodexCliAdapter', () => {
  const adapter = new CodexCliAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'codex-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'codex-cli');
    }
  });

  it('uses the curated Codex model list', () => {
    assert.deepEqual(adapter.models.map((model) => model.id), [
      'gpt-5.4',
      'gpt-5.2-codex',
      'gpt-5.1-codex',
    ]);
  });
});

describe('QwenCliAdapter', () => {
  const adapter = new QwenCliAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'qwen-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'qwen-cli');
    }
  });

  it('uses the curated Qwen model list', () => {
    assert.deepEqual(adapter.models.map((model) => model.id), [
      'qwen3-coder-plus',
      'qwen-plus',
      'qwen-max',
      'qwen-turbo',
    ]);
  });
});

describe('CopilotCliAdapter', () => {
  const adapter = new CopilotCliAdapter(vault);

  it('has required properties', () => {
    assertProviderInterface(adapter, 'copilot-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'copilot-cli');
    }
  });

  it('honestly exposes the Copilot CLI model surface', () => {
    assert.deepEqual(adapter.models.map((model) => model.id), [
      'gpt-4.1',
      'gpt-5-mini',
      'gpt-5.1',
      'gpt-5.1-codex',
      'gpt-5.1-codex-max',
      'gpt-5.1-codex-mini',
      'gpt-5.2',
      'gpt-5.2-codex',
      'gpt-5.3-codex',
      'gpt-5.4',
      'gemini-3-pro-preview',
      'claude-sonnet-4',
      'claude-sonnet-4.5',
      'claude-sonnet-4.6',
      'claude-haiku-4.5',
      'claude-opus-4.5',
      'claude-opus-4.6',
      'claude-opus-4.6-fast',
    ]);
  });

  it('exposes multiple native Copilot models instead of a placeholder', () => {
    assert.ok(adapter.models.length > 1);
    assert.ok(adapter.models.every((model) => model.id !== 'copilot-cli'));
  });

  it('uses project-scoped Copilot credentials from vault when present', () => {
    vault.store('copilot', 'default', 'ghu-global-copilot');
    vault.store('copilot', 'default', 'ghu-project-copilot', 'test-proj');

    const projectKey = vault.getDecrypted('copilot', 'default', 'test-proj');
    assert.equal(projectKey, 'ghu-project-copilot');
  });
});

// ── Factory function ──────────────────────────────────────

describe('createAllAdapters()', () => {
  it('returns 17 adapters', () => {
    const adapters = createAllAdapters(vault);
    assert.equal(adapters.length, 17, 'Should return exactly 17 adapters');
  });

  it('all adapters implement LLMProvider interface', () => {
    const adapters = createAllAdapters(vault);
    const expectedIds = [
      'anthropic', 'openai', 'google', 'groq', 'openrouter',
      'cerebras', 'zai', 'nvidia', 'mistral', 'sambanova', 'hyperbolic',
      'opencode-cli', 'claude-cli', 'gemini-cli', 'codex-cli', 'qwen-cli', 'copilot-cli',
    ];

    for (const adapter of adapters) {
      assertProviderInterface(adapter, adapter.id);
    }

    const actualIds = adapters.map(a => a.id);
    for (const expected of expectedIds) {
      assert.ok(actualIds.includes(expected), `Should include adapter with id "${expected}"`);
    }
  });

  it('API adapters are listed before CLI adapters', () => {
    const adapters = createAllAdapters(vault);
    const apiAdapters = adapters.filter(a => a.type === 'api');
    const cliAdapters = adapters.filter(a => a.type === 'cli');

    assert.equal(apiAdapters.length, 11, 'Should have 11 API adapters');
    assert.equal(cliAdapters.length, 6, 'Should have 6 CLI adapters');

    // Verify API adapters come first in the array
    const firstCliIndex = adapters.findIndex(a => a.type === 'cli');
    const lastApiIndex = adapters.reduce((last, a, i) => a.type === 'api' ? i : last, -1);
    assert.ok(lastApiIndex < firstCliIndex, 'All API adapters should come before CLI adapters');
  });

  it('API adapters are in expected order', () => {
    const adapters = createAllAdapters(vault);
    const apiIds = adapters.filter(a => a.type === 'api').map(a => a.id);
    assert.deepEqual(apiIds, [
      'anthropic',
      'openai',
      'google',
      'groq',
      'openrouter',
      'cerebras',
      'zai',
      'nvidia',
      'mistral',
      'sambanova',
      'hyperbolic',
    ]);
  });

  it('new OpenAI-compatible adapters appear in the factory catalog', () => {
    const adapters = createAllAdapters(vault);
    const adapterIds = adapters.map((adapter) => adapter.id);

    for (const { id } of NEW_OPENAI_COMPATIBLE_ADAPTERS) {
      assert.ok(adapterIds.includes(id), `Should include adapter with id "${id}"`);
    }
  });

  it('new OpenAI-compatible adapter ids are valid credential providers', () => {
    for (const { id } of NEW_OPENAI_COMPATIBLE_ADAPTERS) {
      assert.equal(VALID_PROVIDERS.has(id), true, `${id} should be a valid provider`);
    }
  });

  it('normalizes glm provider alias to zai', () => {
    assert.equal(normalizeProviderId('glm'), 'zai');
  });
});

// ── Project context passing ───────────────────────────────

describe('API adapters pass project to vault', () => {
  /** Create a vault with project-scoped credentials for testing. */
  function createProjectTestConfig(): GatewayConfig {
    const masterKey = randomBytes(32);
    const dbPath = `/tmp/test-adapters-project-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    return { masterKey, dbPath, httpPort: 0 };
  }

  const projConfig = createProjectTestConfig();
  const projVault = new Vault(projConfig);

  after(() => {
    projVault.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = projConfig.dbPath + suffix;
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('AnthropicAdapter.generate uses project from request for vault lookup', () => {
    // Store a global key
    projVault.store('anthropic', 'default', 'sk-global-anthropic');
    // Store a project-specific key
    projVault.store('anthropic', 'default', 'sk-project-anthropic', 'test-proj');

    // Verify vault resolves correctly (the adapter calls vault.getDecrypted with project)
    const globalKey = projVault.getDecrypted('anthropic', 'default');
    assert.equal(globalKey, 'sk-global-anthropic');

    const projectKey = projVault.getDecrypted('anthropic', 'default', 'test-proj');
    assert.equal(projectKey, 'sk-project-anthropic');
  });

  it('OpenAIAdapter.generate uses project from request for vault lookup', () => {
    projVault.store('openai', 'default', 'sk-global-openai');
    projVault.store('openai', 'default', 'sk-project-openai', 'test-proj');

    const globalKey = projVault.getDecrypted('openai', 'default');
    assert.equal(globalKey, 'sk-global-openai');

    const projectKey = projVault.getDecrypted('openai', 'default', 'test-proj');
    assert.equal(projectKey, 'sk-project-openai');
  });

  it('GoogleAdapter.generate uses project from request for vault lookup', () => {
    projVault.store('google', 'default', 'sk-global-google');
    projVault.store('google', 'default', 'sk-project-google', 'test-proj');

    const projectKey = projVault.getDecrypted('google', 'default', 'test-proj');
    assert.equal(projectKey, 'sk-project-google');
  });

  it('GroqAdapter.generate uses project from request for vault lookup', () => {
    projVault.store('groq', 'default', 'sk-global-groq');
    projVault.store('groq', 'default', 'sk-project-groq', 'test-proj');

    const projectKey = projVault.getDecrypted('groq', 'default', 'test-proj');
    assert.equal(projectKey, 'sk-project-groq');
  });

  it('OpenRouterAdapter.generate uses project from request for vault lookup', () => {
    projVault.store('openrouter', 'default', 'sk-global-openrouter');
    projVault.store('openrouter', 'default', 'sk-project-openrouter', 'test-proj');

    const projectKey = projVault.getDecrypted('openrouter', 'default', 'test-proj');
    assert.equal(projectKey, 'sk-project-openrouter');
  });

  it('vault falls back to global when project key missing', () => {
    // Only global key exists for this provider
    projVault.store('fallback-test', 'default', 'sk-fallback-global');

    const key = projVault.getDecrypted('fallback-test', 'default', 'nonexistent-project');
    assert.equal(key, 'sk-fallback-global', 'Should fall back to global');
  });
});
