/**
 * Dynamic model discovery tests (Batch 1).
 *
 * Covers the TTL-cached refresh infra in BaseCliAdapter, the mergeModels
 * helper, the codex config.toml parser, and a REAL read of the user's
 * ~/.codex/config.toml to confirm the configured model is discovered.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Vault } from '../src/vault/vault.js';
import { BaseCliAdapter, type CliAdapterConfig } from '../src/adapters/base-cli-adapter.js';
import { mergeModels, MODEL_DISCOVERY_ERROR_RETRY_MS } from '../src/adapters/model-cache.js';
import { OpenAIAdapter, AnthropicAdapter, GoogleAdapter } from '../src/adapters/index.js';
import { CodexCliAdapter, parseCodexModel } from '../src/adapters/cli-codex.js';
import type { GatewayConfig, ModelInfo } from '../src/core/types.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-dyn-${Date.now()}.db`,
  httpPort: 0,
};
const vault = new Vault(config);

process.on('exit', () => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

// ── parseCodexModel (pure) ─────────────────────────────────────

describe('parseCodexModel', () => {
  it('extracts the top-level model key', () => {
    assert.equal(parseCodexModel('model = "gpt-5.5"\n[projects."/x"]\n'), 'gpt-5.5');
  });

  it('ignores comments and blank lines before the key', () => {
    assert.equal(parseCodexModel('# header\n\nmodel = "gpt-5.4"\n'), 'gpt-5.4');
  });

  it('does NOT read a model key inside a section (top-level only)', () => {
    assert.equal(parseCodexModel('[profile]\nmodel = "leaked"\n'), null);
  });

  it('accepts single-quoted (literal) TOML strings', () => {
    assert.equal(parseCodexModel("model = 'gpt-5.5'\n"), 'gpt-5.5');
  });

  it('handles CRLF line endings', () => {
    assert.equal(parseCodexModel('# c\r\nmodel = "gpt-5.4"\r\n'), 'gpt-5.4');
  });

  it('returns null when no model key is present', () => {
    assert.equal(parseCodexModel('approval_policy = "on-request"\n'), null);
  });
});

// ── mergeModels ────────────────────────────────────────────────

describe('mergeModels', () => {
  const m = (id: string, name = id): ModelInfo => ({ id, name, provider: 'p', maxTokens: 1 });

  it('keeps declared first and appends discovered-only ids', () => {
    const result = mergeModels([m('a'), m('b')], [m('c')]);
    assert.deepEqual(result.map((x) => x.id), ['a', 'b', 'c']);
  });

  it('declared (curated) metadata wins on id collision', () => {
    const result = mergeModels([m('a', 'DECLARED')], [m('a', 'DISCOVERED')]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, 'DECLARED');
  });

  it('handles empty discovered and empty declared', () => {
    assert.deepEqual(mergeModels([m('a')], []).map((x) => x.id), ['a']);
    assert.deepEqual(mergeModels([], [m('a')]).map((x) => x.id), ['a']);
    assert.deepEqual(mergeModels([], []), []);
  });
});

// ── refreshModels TTL behavior ─────────────────────────────────

class CountingAdapter extends BaseCliAdapter {
  readonly config: CliAdapterConfig = {
    id: 'count-cli',
    name: 'Counting',
    cliCommand: 'noop',
    defaultModel: 'decl',
    models: [{ id: 'decl', name: 'decl', provider: 'count-cli', maxTokens: 1 }],
  };
  public discoverCalls = 0;
  protected buildArgs(): string[] {
    return [];
  }
  protected parseResponse(output: string): string {
    return output;
  }
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    this.discoverCalls++;
    return [{ id: 'dyn', name: 'dyn', provider: 'count-cli', maxTokens: 1 }];
  }
}

/** Discovery has no dynamic source — returns null. */
class NullAdapter extends CountingAdapter {
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    this.discoverCalls++;
    return null;
  }
}

/** Discovery throws (transient failure). */
class ThrowingAdapter extends CountingAdapter {
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    this.discoverCalls++;
    throw new Error('boom');
  }
}

describe('BaseCliAdapter.refreshModels (TTL)', () => {
  it('returns the declared list before any refresh', () => {
    const a = new CountingAdapter(vault);
    assert.deepEqual(a.models.map((x) => x.id), ['decl']);
    assert.equal(a.discoverCalls, 0);
  });

  it('null discovery keeps exactly the declared list (full TTL, no churn)', async () => {
    const a = new NullAdapter(vault);
    await a.refreshModels(0);
    assert.deepEqual(a.models.map((x) => x.id), ['decl']);
    await a.refreshModels(1000); // within TTL → no re-discover
    assert.equal(a.discoverCalls, 1);
  });

  it('thrown discovery degrades to declared and retries after the error window', async () => {
    const a = new ThrowingAdapter(vault);
    await a.refreshModels(0);
    assert.deepEqual(a.models.map((x) => x.id), ['decl']); // degraded, not thrown
    await a.refreshModels(MODEL_DISCOVERY_ERROR_RETRY_MS - 1); // still inside the error window
    assert.equal(a.discoverCalls, 1);
    await a.refreshModels(MODEL_DISCOVERY_ERROR_RETRY_MS); // window elapsed → retry
    assert.equal(a.discoverCalls, 2);
  });

  it('single-flights concurrent refreshes into one discovery', async () => {
    const a = new CountingAdapter(vault);
    await Promise.all([a.refreshModels(0), a.refreshModels(0), a.refreshModels(0)]);
    assert.equal(a.discoverCalls, 1); // not 3
  });

  it('merges declared + discovered after refresh', async () => {
    const a = new CountingAdapter(vault);
    await a.refreshModels(0);
    assert.deepEqual(a.models.map((x) => x.id), ['decl', 'dyn']);
    assert.equal(a.discoverCalls, 1);
  });

  it('does not re-discover within the TTL window', async () => {
    const a = new CountingAdapter(vault);
    await a.refreshModels(0);
    await a.refreshModels(1000); // within 5min TTL
    assert.equal(a.discoverCalls, 1);
  });

  it('re-discovers once the TTL has elapsed', async () => {
    const a = new CountingAdapter(vault);
    await a.refreshModels(0);
    await a.refreshModels(5 * 60 * 1000 + 1);
    assert.equal(a.discoverCalls, 2);
  });
});

// ── API adapters: graceful degradation without credentials ─────

describe('API adapters refreshModels (no credentials)', () => {
  const emptyVault = () =>
    new Vault({ masterKey: randomBytes(32), dbPath: `/tmp/test-dyn-api-${randomBytes(6).toString('hex')}.db`, httpPort: 0 });

  it('lazy cache returns declared models before any refresh', () => {
    const v = emptyVault();
    // GoogleAdapter uses the base lazy getter; .models must work pre-refresh.
    const a = new GoogleAdapter(v);
    assert.deepEqual(a.models.map((x) => x.id), ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']);
    v.close();
  });

  it('OpenAI keeps declared models when no API key is present', async () => {
    const v = emptyVault();
    const a = new OpenAIAdapter(v);
    await a.refreshModels(0); // discover hits no creds → null → declared, no network
    assert.deepEqual(a.models.map((x) => x.id), ['gpt-4o', 'gpt-4o-mini', 'o3-mini']);
    v.close();
  });

  it('Anthropic keeps declared models when no credentials are present', async () => {
    const v = emptyVault();
    const a = new AnthropicAdapter(v);
    await a.refreshModels(0);
    assert.ok(a.models.some((x) => x.id === 'claude-sonnet-4-20250514'));
    v.close();
  });

  it('Google (OpenAI-compatible base) keeps declared models with no key', async () => {
    const v = emptyVault();
    const a = new GoogleAdapter(v);
    await a.refreshModels(0);
    assert.deepEqual(a.models.map((x) => x.id), ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']);
    v.close();
  });
});

// ── REAL discovery from the user's codex config ────────────────

describe('CodexCliAdapter discovery source (vault vs real home)', () => {
  it('prefers a vaulted config.toml over the real home (matches execution HOME)', async () => {
    const v = new Vault({ masterKey: randomBytes(32), dbPath: `/tmp/test-dyn-vault-${Date.now()}.db`, httpPort: 0 });
    v.storeFile('codex', 'config.toml', 'model = "gpt-vaulted"\n');
    const adapter = new CodexCliAdapter(v);
    await adapter.refreshModels(0);
    const ids = adapter.models.map((x) => x.id);
    assert.ok(ids.includes('gpt-vaulted'), 'vaulted model not discovered');
    // declared fallback is still preserved alongside the discovered model
    assert.ok(ids.includes('gpt-5.4'), 'declared fallback lost');
    v.close();
  });

  it('returns declared-only when vault has codex files but no config.toml', async () => {
    const v = new Vault({ masterKey: randomBytes(32), dbPath: `/tmp/test-dyn-vault2-${Date.now()}.db`, httpPort: 0 });
    v.storeFile('codex', 'auth.json', '{"token":"x"}');
    const adapter = new CodexCliAdapter(v);
    await adapter.refreshModels(0);
    assert.deepEqual(adapter.models.map((x) => x.id), [
      'gpt-5.6-sol',
      'gpt-5.4',
      'gpt-5.2-codex',
      'gpt-5.1-codex',
    ]);
    v.close();
  });
});

describe('CodexCliAdapter dynamic discovery (real config)', () => {
  it('discovers the configured codex model and keeps the declared fallback', async (t) => {
    const cfgPath = join(homedir(), '.codex', 'config.toml');
    if (!existsSync(cfgPath)) {
      t.skip('no ~/.codex/config.toml on this host');
      return;
    }
    const expected = parseCodexModel(readFileSync(cfgPath, 'utf8'));
    const adapter = new CodexCliAdapter(vault);
    await adapter.refreshModels(0);
    const ids = adapter.models.map((x) => x.id);

    // Declared fallback is never lost
    assert.ok(ids.includes('gpt-5.4'), 'declared fallback gpt-5.4 missing');
    // The configured model (e.g. gpt-5.5) is discovered dynamically
    if (expected) {
      assert.ok(ids.includes(expected), `configured model ${expected} not discovered`);
    }
  });
});
