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
import { BaseCliAdapter, mergeModels, type CliAdapterConfig } from '../src/adapters/base-cli-adapter.js';
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

  it('appends declared-only entries after discovered', () => {
    const result = mergeModels([m('a'), m('b')], [m('c')]);
    assert.deepEqual(result.map((x) => x.id), ['c', 'a', 'b']);
  });

  it('discovered takes precedence on id collision', () => {
    const result = mergeModels([m('a', 'DECLARED')], [m('a', 'DISCOVERED')]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, 'DISCOVERED');
  });
});

// ── refreshModels TTL behavior ─────────────────────────────────

class CountingAdapter extends BaseCliAdapter {
  readonly config: CliAdapterConfig = {
    id: 'count-cli',
    name: 'Counting',
    cliCommand: 'noop',
    defaultModel: 'decl',
    supportsSystemPrompt: false,
    models: [{ id: 'decl', name: 'decl', provider: 'count-cli', maxTokens: 1 }],
  };
  public discoverCalls = 0;
  protected buildArgs(): string[] {
    return [];
  }
  protected parseResponse(output: string): string {
    return output;
  }
  protected async discoverModels(): Promise<ModelInfo[]> {
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
    await a.refreshModels(29_999); // still inside the 30s error window
    assert.equal(a.discoverCalls, 1);
    await a.refreshModels(30_000); // error window elapsed → retry
    assert.equal(a.discoverCalls, 2);
  });

  it('merges discovered + declared after refresh', async () => {
    const a = new CountingAdapter(vault);
    await a.refreshModels(0);
    assert.deepEqual(a.models.map((x) => x.id), ['dyn', 'decl']);
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
    assert.deepEqual(adapter.models.map((x) => x.id), ['gpt-5.4', 'gpt-5.2-codex', 'gpt-5.1-codex']);
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
