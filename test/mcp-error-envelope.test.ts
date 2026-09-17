import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dispatchToolCall } from '../src/server/mcp-dispatcher.js';
import { handleDiscoverModelsTool } from '../src/server/mcp-llm-handlers.js';
import type { Router } from '../src/core/router.js';
import type { Vault } from '../src/vault/vault.js';

describe('MCP error envelopes', () => {
  it('redacts credential-like generate failures before returning to the client', async () => {
    const router = {
      generate: async () => {
        throw new Error('upstream failed Bearer sk-live-secret token=abc123456789');
      },
    } as Pick<Router, 'generate'>;

    const result = await dispatchToolCall(
      'llm_generate',
      { prompt: 'hello' },
      { router: router as Router, vault: {} as Vault },
    );

    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error?: string };
    assert.equal(typeof payload.error, 'string');
    assert.doesNotMatch(payload.error ?? '', /sk-live-secret|abc123456789/i);
    assert.match(payload.error ?? '', /Bearer \[REDACTED\]/i);
  });

  it('redacts discover_models catch payloads', async () => {
    const result = await handleDiscoverModelsTool(
      { hfToken: 'hf_should_not_matter' },
      {
        getDb: () => {
          throw new Error('vault token=supersecretvalue Bearer abcdef');
        },
      } as unknown as Vault,
    );

    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error?: string };
    assert.doesNotMatch(payload.error ?? '', /supersecretvalue|abcdef/i);
  });
});
