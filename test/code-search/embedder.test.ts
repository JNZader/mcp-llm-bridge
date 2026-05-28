/**
 * Unit tests for embedder abstraction.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LocalEmbedder, ApiEmbedder, createEmbedder } from '../../src/code-search/embedder.js';

describe('LocalEmbedder', () => {
  it('loads model and embeds text to 384-dim Float32Array', async () => {
    const embedder = LocalEmbedder.getInstance();
    const vector = await embedder.embed('hello world');
    assert.equal(vector.length, 384);
    assert.ok(vector instanceof Float32Array);
  });

  it('returns same model instance (singleton)', () => {
    const a = LocalEmbedder.getInstance();
    const b = LocalEmbedder.getInstance();
    assert.strictEqual(a, b);
  });
});

describe('ApiEmbedder', () => {
  it('calls OpenAI mock and returns Float32Array', async () => {
    let createCalled = false;
    const mockClient = {
      embeddings: {
        create: async (_params: unknown) => {
          createCalled = true;
          return {
            data: [
              {
                embedding: Array(1536).fill(0.1),
                index: 0,
                object: 'embedding' as const,
              },
            ],
            model: 'text-embedding-3-small',
            object: 'list' as const,
            usage: { prompt_tokens: 2, total_tokens: 2 },
          };
        },
      },
    } as unknown as import('openai').default;

    const embedder = new ApiEmbedder('test-key', mockClient);
    const vector = await embedder.embed('hello');

    assert.ok(createCalled, 'mock create should be called');
    assert.equal(vector.length, 1536);
    assert.ok(vector instanceof Float32Array);
  });
});

describe('createEmbedder factory', () => {
  const originalEnv = process.env['OPENAI_API_KEY'];

  before(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  after(() => {
    if (originalEnv !== undefined) {
      process.env['OPENAI_API_KEY'] = originalEnv;
    }
  });

  it('falls back to api when local fails', async () => {
    const mockLocal = {
      embed: async () => {
        throw new Error('local failed');
      },
    };
    const mockApi = {
      embed: async () => {
        return new Float32Array(384);
      },
    };

    const embedder = await createEmbedder(true, { local: mockLocal, api: mockApi });
    const result = await embedder.embed('test');
    assert.equal(result.length, 384);
  });

  it('throws if both local and api fail', async () => {
    const mockLocal = {
      embed: async () => {
        throw new Error('local failed');
      },
    };

    // No OPENAI_API_KEY, no deps.api → ApiEmbedder constructor throws
    await assert.rejects(
      () => createEmbedder(true, { local: mockLocal }),
      /No embedder available/,
    );
  });
});
