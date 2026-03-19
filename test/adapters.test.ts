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
  ClaudeCliAdapter,
  GeminiCliAdapter,
  CodexCliAdapter,
  CopilotCliAdapter,
  createAllAdapters,
} from '../src/adapters/index.js';

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

describe('ClaudeCliAdapter', () => {
  const adapter = new ClaudeCliAdapter();

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

describe('GeminiCliAdapter', () => {
  const adapter = new GeminiCliAdapter();

  it('has required properties', () => {
    assertProviderInterface(adapter, 'gemini-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'gemini-cli');
    }
  });
});

describe('CodexCliAdapter', () => {
  const adapter = new CodexCliAdapter();

  it('has required properties', () => {
    assertProviderInterface(adapter, 'codex-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'codex-cli');
    }
  });
});

describe('CopilotCliAdapter', () => {
  const adapter = new CopilotCliAdapter();

  it('has required properties', () => {
    assertProviderInterface(adapter, 'copilot-cli');
    assert.equal(adapter.type, 'cli');
  });

  it('models have required fields', () => {
    for (const model of adapter.models) {
      assertModelInfo(model, 'copilot-cli');
    }
  });
});

// ── Factory function ──────────────────────────────────────

describe('createAllAdapters()', () => {
  it('returns 6 adapters', () => {
    const adapters = createAllAdapters(vault);
    assert.equal(adapters.length, 6, 'Should return exactly 6 adapters');
  });

  it('all adapters implement LLMProvider interface', () => {
    const adapters = createAllAdapters(vault);
    const expectedIds = ['anthropic', 'openai', 'claude-cli', 'gemini-cli', 'codex-cli', 'copilot-cli'];

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

    assert.equal(apiAdapters.length, 2, 'Should have 2 API adapters');
    assert.equal(cliAdapters.length, 4, 'Should have 4 CLI adapters');

    // Verify API adapters come first in the array
    const firstCliIndex = adapters.findIndex(a => a.type === 'cli');
    const lastApiIndex = adapters.reduce((last, a, i) => a.type === 'api' ? i : last, -1);
    assert.ok(lastApiIndex < firstCliIndex, 'All API adapters should come before CLI adapters');
  });
});
