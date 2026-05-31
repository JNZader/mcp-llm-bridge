/**
 * MCP local LLM tool tests — verify local_llm_generate and discover_models.
 */

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { handleToolCall } from '../src/server/mcp.js';
import { handleLocalLlmGenerateTool } from '../src/server/mcp-llm-handlers.js';
import type { GatewayConfig, LLMProvider, GenerateResponse } from '../src/core/types.js';
import { LocalLLMProvider } from '../src/local-llm/provider.js';
import { resetLocalLLMDetectionCache } from '../src/local-llm/detector.js';

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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// ── local_llm_generate ───────────────────────────────────

describe('local_llm_generate MCP tool', () => {
  beforeEach(() => {
    delete process.env['LOCAL_LLM_ENABLED'];
    delete process.env['OLLAMA_URL'];
    delete process.env['LM_STUDIO_URL'];
  });

  afterEach(() => {
    mock.restoreAll();
    resetLocalLLMDetectionCache();
    delete process.env['LOCAL_LLM_ENABLED'];
    delete process.env['OLLAMA_URL'];
    delete process.env['LM_STUDIO_URL'];
  });

  it('returns cloud backend when LOCAL_LLM_ENABLED=false', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'false';
    const result = await callTool('local_llm_generate', { prompt: 'hello' });
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'cloud');
    assert.equal(text.localLLMStatus.enabled, false);
    assert.equal(text.localLLMStatus.source, 'disabled');
    assert.equal(text.localLLMStatus.readyReason, 'Local LLM is disabled by runtime flag');
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
    assert.equal(typeof text.localLLMStatus.disconnectedBackendCount, 'number');
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

  it('routes explicit local generation through router.generate with local-llm provider', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'true';

    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({
          models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }],
        });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const routerStub = {
      async generate(request: Record<string, unknown>): Promise<GenerateResponse> {
        assert.deepEqual(request, {
          prompt: 'write a commit message',
          system: undefined,
          maxTokens: undefined,
          provider: 'local-llm',
          model: 'llama3.2:3b',
        });

        return {
          text: 'local result',
          provider: 'local-llm',
          model: 'llama3.2:3b',
          resolvedProvider: 'local-llm',
          resolvedModel: 'llama3.2:3b',
          fallbackUsed: false,
        };
      },
    } as unknown as Router;

    const result = await handleLocalLlmGenerateTool(
      { prompt: 'write a commit message', preferredModel: 'llama3.2:3b' },
      routerStub,
    );

    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'local');
    assert.equal(text.provider, 'local-llm');
    assert.equal(text.resolvedProvider, 'local-llm');
    assert.equal(text.localBackend, 'ollama');
    assert.equal(text.localModelId, 'llama3.2:3b');
  });

  it('honors custom local backend URLs through the shared provider path', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'true';
    process.env['OLLAMA_URL'] = 'http://127.0.0.1:11434';
    process.env['LM_STUDIO_URL'] = 'http://127.0.0.1:1234';

    const fetchMock = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url === 'http://127.0.0.1:11434/api/tags') {
        return jsonResponse({
          models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }],
        });
      }

      if (url === 'http://127.0.0.1:1234/v1/models') {
        return jsonResponse({ data: [] });
      }

      if (url === 'http://127.0.0.1:11434/v1/chat/completions') {
        assert.equal(init?.method, 'POST');
        return jsonResponse({
          choices: [{ message: { content: 'local custom url result' }, finish_reason: 'stop' }],
          usage: { total_tokens: 12 },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const localRouter = new Router();
    localRouter.register(mockCloudProvider);
    localRouter.register(
      new LocalLLMProvider({
        enabled: true,
        ollamaUrl: 'http://127.0.0.1:11434',
        lmStudioUrl: 'http://127.0.0.1:1234',
      }),
    );

    const result = await handleLocalLlmGenerateTool(
      { prompt: 'write a commit message' },
      localRouter,
    );

    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'local');
    assert.equal(text.provider, 'local-llm');
    assert.equal(text.localBackend, 'ollama');
    assert.equal(text.localModelId, 'llama3.2:3b');
    assert.ok(
      fetchMock.mock.calls.some(
        (call) => String(call.arguments[0]) === 'http://127.0.0.1:11434/v1/chat/completions',
      ),
    );
  });

  it('falls back consistently when the shared local provider path fails', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'true';

    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({
          models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }],
        });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      if (url.includes('/v1/chat/completions')) {
        return jsonResponse({ error: 'local backend down' }, 503);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const localRouter = new Router();
    localRouter.register(
      new LocalLLMProvider({
        enabled: true,
        ollamaUrl: 'http://localhost:11434',
        lmStudioUrl: 'http://localhost:1234',
      }),
    );
    localRouter.register(mockCloudProvider);

    const result = await handleLocalLlmGenerateTool(
      { prompt: 'write a commit message' },
      localRouter,
    );

    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'cloud');
    assert.equal(text.provider, 'mock-cloud');
    assert.equal(text.fallbackUsed, true);
    assert.match(text.fallbackReason, /Local LLM provider failed/i);
    assert.equal(text.attemptedLocalBackend, 'ollama');
    assert.equal(text.attemptedLocalModelId, 'llama3.2:3b');
    assert.equal(typeof text.localLLMStatus.connectedBackendCount, 'number');
    assert.ok(Array.isArray(text.localLLMStatus.backends[0]?.models));
  });

  it('keeps short generic prompts on cloud even when a local model is available', async () => {
    process.env['LOCAL_LLM_ENABLED'] = 'true';

    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({
          models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }],
        });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      if (url.includes('/v1/chat/completions')) {
        throw new Error('Short generic prompts should not hit the local generation endpoint');
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const localRouter = new Router();
    localRouter.register(
      new LocalLLMProvider({
        enabled: true,
        ollamaUrl: 'http://localhost:11434',
        lmStudioUrl: 'http://localhost:1234',
      }),
    );
    localRouter.register(mockCloudProvider);

    const result = await handleLocalLlmGenerateTool(
      { prompt: 'hi' },
      localRouter,
    );

    const text = JSON.parse(result.content[0]!.text);
    assert.equal(text.backend, 'cloud');
    assert.equal(text.provider, 'mock-cloud');
    assert.match(text.reason, /Task not offloadable/i);
    assert.ok(
      fetchMock.mock.calls.every(
        (call) => !String(call.arguments[0]).includes('/v1/chat/completions'),
      ),
    );
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
    assert.equal(typeof text.localLLMStatus.enabled, 'boolean');
    assert.equal(typeof text.localLLMStatus.checkedAt, 'string');
    assert.equal(typeof text.localLLMStatus.readyReason, 'string');
    assert.ok(Array.isArray(text.localLLMStatus.backends));
    assert.equal(typeof text.localLLMStatus.backends[0]?.modelCount, 'number');
    assert.ok(Array.isArray(text.localLLMStatus.backends[0]?.models));
  });

  it('accepts optional hfToken', async () => {
    const result = await callTool('discover_models', { hfToken: 'fake-token' });
    assert.equal(result.isError, undefined);
    const text = JSON.parse(result.content[0]!.text);
    assert.ok(Array.isArray(text.models));
  });
});
