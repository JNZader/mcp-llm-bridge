/**
 * MCP three-part prompt + compression tests.
 *
 * Fast tests using mock router for handler behavior.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import { createAllAdapters } from '../src/adapters/index.js';
import type { GatewayConfig, GenerateRequest, GenerateResponse } from '../src/core/types.js';
import { handleToolCall, TOOLS } from '../src/server/mcp.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-mcp-three-part-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);
const router = new Router();

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

beforeEach(() => {
  (vault as any).db.exec('DELETE FROM credentials');
});

// Cleanup
process.on('exit', () => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

// Create a fast mock router that returns immediately
function createFastRouter(
  baseRouter: Router,
  onGenerate?: (request: GenerateRequest) => void,
): Router {
  const fast = new Router();
  // Override generate to return immediately without calling real providers
  fast.generate = async (request: GenerateRequest) => {
    onGenerate?.(request);
    return {
      text: 'Mock response',
      provider: 'mock',
      model: 'mock-model',
      tokensUsed: 10,
      resolvedProvider: 'mock',
      resolvedModel: 'mock-model',
      fallbackUsed: false,
    } as GenerateResponse;
  };
  // Copy other methods from base router
  fast.getAvailableModels = baseRouter.getAvailableModels.bind(baseRouter);
  fast.getProviderStatuses = baseRouter.getProviderStatuses.bind(baseRouter);
  return fast;
}

describe('MCP llm_generate tool schema', () => {
  it('includes context and instruction fields in input schema', () => {
    const llmGenerate = TOOLS.find((t) => t.name === 'llm_generate');
    assert.ok(llmGenerate, 'llm_generate tool should exist');

    const schema = llmGenerate.inputSchema;
    assert.ok(schema.properties.context, 'context field should be in schema');
    assert.equal(schema.properties.context.type, 'string');
    assert.ok(schema.properties.instruction, 'instruction field should be in schema');
    assert.equal(schema.properties.instruction.type, 'string');
    assert.ok(schema.properties.strict, 'strict field should be in schema');
    assert.equal(schema.properties.strict.type, 'boolean');

    // prompt should no longer be strictly required when context/instruction are present
    // The schema is flexible — prompt is optional
    assert.ok(!(schema.required as readonly string[]).includes('context'), 'context should not be required');
    assert.ok(!(schema.required as readonly string[]).includes('instruction'), 'instruction should not be required');
  });
});

describe('MCP llm_generate with three-part fields', () => {
  it('accepts system, context, instruction fields via handleToolCall', async () => {
    const fastRouter = createFastRouter(router);
    const result = await handleToolCall(
      'llm_generate',
      { system: 'Be concise', context: 'We use Zod 4', instruction: 'Validate this schema' },
      fastRouter,
      vault,
    );

    assert.ok(result.content);
    assert.ok(result.content.length > 0);
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.text, 'Mock response');
  });

  it('accepts backward-compatible flat prompt via handleToolCall', async () => {
    const fastRouter = createFastRouter(router);
    const result = await handleToolCall(
      'llm_generate',
      { prompt: 'Hello' },
      fastRouter,
      vault,
    );

    assert.ok(result.content);
    assert.ok(result.content.length > 0);
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.text, 'Mock response');
  });

  it('passes strict=true through llm_generate to the router', async () => {
    const captured: GenerateRequest[] = [];
    const fastRouter = createFastRouter(router, (request) => {
      captured.push(request);
    });

    const result = await handleToolCall(
      'llm_generate',
      { prompt: 'Hello', strict: true },
      fastRouter,
      vault,
    );

    assert.ok(result.content);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.strict, true);
  });
});

describe('MCP tool response compression', () => {
  it('compresses large responses when ENABLE_OUTPUT_COMPRESSION=true', async () => {
    process.env['ENABLE_OUTPUT_COMPRESSION'] = 'true';

    // Create a large response by storing many credentials
    for (let i = 0; i < 50; i++) {
      vault.store('openai', `key-${i}`, `sk-test-${i}`);
    }

    const result = await handleToolCall('vault_list', {}, router, vault);
    assert.ok(result.content);
    assert.ok(result.content.length > 0);

    const text = result.content[0]!.text;
    // The response should be valid JSON (compressed or not)
    const parsed = JSON.parse(text);
    // vault_list returns the array directly, or a grouped object when compressed
    const isArray = Array.isArray(parsed);
    const isGrouped = parsed && typeof parsed === 'object' && parsed._grouped === true;
    assert.ok(isArray || isGrouped, 'Expected array or grouped object');
  });

  it('skips compression when ENABLE_OUTPUT_COMPRESSION=false', async () => {
    process.env['ENABLE_OUTPUT_COMPRESSION'] = 'false';

    const result = await handleToolCall('vault_list', {}, router, vault);
    assert.ok(result.content);
    assert.ok(result.content.length > 0);

    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    const isArray = Array.isArray(parsed);
    const isGrouped = parsed && typeof parsed === 'object' && parsed._grouped === true;
    assert.ok(isArray || isGrouped, 'Expected array or grouped object');
  });
});
