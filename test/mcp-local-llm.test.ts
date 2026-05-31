/**
 * MCP local LLM tool tests — verify local_llm_generate and discover_models.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { handleToolCall } from '../src/server/mcp.js';
import type { GatewayConfig, LLMProvider, GenerateResponse } from '../src/core/types.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-mcp-local-llm-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);
const router = new Router();

// Register a fast mock cloud provider so fallback doesn't hang on CLI adapters
const mockCloudProvider: LLMProvider = {
  id: 'mock-cloud',
  name: 'Mock Cloud',
  type: 'api',
  models: [{ id: 'mock-model', name: 'Mock Model', provider: 'mock-cloud', maxTokens: 4096 }],
  async isAvailable() { return true; },
  async generate(): Promise<GenerateResponse> {
    return {
      text: 'mock cloud result',
      provider: 'mock-cloud',
      model: 'mock-model',
      resolvedProvider: 'mock-cloud',
      resolvedModel: 'mock-model',
      fallbackUsed: false,
    };
  },
};

router.register(mockCloudProvider);

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

// Cleanup
process.on('exit', () => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

// ── Helpers ──────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>) {
  return handleToolCall(name, args, router, vault);
}

// ── local_llm_generate ───────────────────────────────────

describe('local_llm_generate MCP tool', () => {
  beforeEach(() => {
    delete process.env['LOCAL_LLM_ENABLED'];
  });

  it('returns cloud backend when LOCAL_LLM_ENABLED=false', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'false';
    const result = await callTool('local_llm_generate', { prompt: 'hello' });
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'cloud');
    assert.equal(text.localLLMStatus.enabled, false);
    assert.equal(text.localLLMStatus.source, 'disabled');
  });

  it('returns cloud fallback when no local models available', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'true';
    const result = await callTool('local_llm_generate', { prompt: 'hello' });
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'cloud');
    assert.ok(text.reason?.includes('No local models available'));
    assert.equal(typeof text.localLLMStatus.checkedAt, 'string');
    assert.equal(typeof text.localLLMStatus.backendCount, 'number');
  });

  it('returns cloud fallback for non-offloadable task', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'true';
    const result = await callTool('local_llm_generate', {
      prompt: 'security audit and threat model',
    });
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'cloud');
    // Should route to cloud because complex tasks are not offloadable
    assert.equal(text.provider, 'mock-cloud');
    assert.equal(typeof text.localLLMStatus.modelCount, 'number');
  });
});

// ── discover_models ──────────────────────────────────────

describe('discover_models MCP tool', () => {
  it('returns discovery result with backends scanned', async () => {
    const result = await callTool('discover_models', {});
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.ok(Array.isArray(text.models));
    assert.ok(Array.isArray(text.backendsScanned));
    assert.equal(typeof text.enrichedCount, 'number');
    assert.equal(typeof text.unenrichedCount, 'number');
    assert.equal(typeof text.partial, 'boolean');
    assert.equal(typeof text.snapshotUsed, 'boolean');
    assert.ok(text.backendsScanned.includes('ollama'));
    assert.ok(text.backendsScanned.includes('lm-studio'));
  });

  it('accepts optional hfToken', async () => {
    const result = await callTool('discover_models', { hfToken: 'fake-token' });
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.ok(Array.isArray(text.models));
  });
});
