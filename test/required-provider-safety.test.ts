import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { chatCompletionsSchema, generateRequestSchema } from '../src/core/schemas.js';
import type { Router } from '../src/core/router.js';
import { handleLlmGenerateTool } from '../src/server/mcp-llm-handlers.js';

describe('requireProvider boundary safety', () => {
  it('accepts only the explicit tools=none opt-in', () => {
    assert.equal(generateRequestSchema.safeParse({ prompt: 'test', tools: 'none' }).success, true);
    assert.equal(generateRequestSchema.safeParse({ prompt: 'test', tools: 'auto' }).success, false);
  });
  it('rejects invalid generate inputs before provider availability', () => {
    const invalidProviders: unknown[] = [undefined, '', '  ', null, 7, [], {}];
    for (const provider of invalidProviders) {
      assert.equal(generateRequestSchema.safeParse({ prompt: 'test', provider, requireProvider: true }).success, false);
    }
    for (const requireProvider of [null, 1, 'true', [], {}] as unknown[]) {
      assert.equal(generateRequestSchema.safeParse({ prompt: 'test', provider: 'target', requireProvider }).success, false);
    }
    assert.equal(generateRequestSchema.safeParse({ prompt: 'test', provider: 'target', requireProvider: true }).success, true);
  });

  it('rejects explicit JSON flags while accepting unrelated extensions', () => {
    const base = { messages: [{ role: 'user', content: 'test' }] };
    assert.equal(chatCompletionsSchema.safeParse({ ...base, requireProvider: true }).success, false);
    assert.equal(chatCompletionsSchema.safeParse({ ...base, requireProvider: false }).success, false);
    assert.equal(chatCompletionsSchema.safeParse({ ...base, extension: { preserve: true } }).success, true);
  });

  it('rejects its own flag before dispatch and leaves normal MCP generation intact', async () => {
    const generate = mock.fn(async () => ({ text: 'ok', provider: 'target', model: 'target-model', resolvedProvider: 'target', resolvedModel: 'target-model', fallbackUsed: false }));
    const router = { generate } as Pick<Router, 'generate'>;
    for (const requireProvider of [true, false]) {
      const result = await handleLlmGenerateTool({ prompt: 'test', requireProvider }, router as Router, undefined);
      assert.equal(result.isError, true);
    }
    assert.equal(generate.mock.callCount(), 0);
    const normal = await handleLlmGenerateTool({ prompt: 'test' }, router as Router, undefined);
    assert.equal(normal.isError, undefined);
    assert.equal(generate.mock.callCount(), 1);
  });
});
