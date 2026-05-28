/**
 * E2E integration tests for code_search MCP tool with mode parameter.
 *
 * Tests keyword, vector, hybrid, backward compatibility (no mode),
 * and embedder failure handling.
 */

// Disable output compression so assertions see raw arrays
process.env['ENABLE_OUTPUT_COMPRESSION'] = 'false';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { handleToolCall } from '../../src/server/mcp.js';
import { CodeSearchService } from '../../src/code-search/searcher.js';
import type { Embedder } from '../../src/code-search/embedder.js';
import type { Router } from '../../src/core/router.js';

const TEST_DIR = join('/tmp', `code-search-mcp-e2e-${Date.now()}`);

/** Simple deterministic embedder for testing. */
class MockEmbedder implements Embedder {
  private vocab = ['authenticate', 'authorize', 'validate', 'server', 'logger', 'function', 'export', 'class'];

  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(this.vocab.length);
    const lower = text.toLowerCase();
    for (let i = 0; i < this.vocab.length; i++) {
      vec[i] = lower.includes(this.vocab[i]!) ? 1 : 0;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] = vec[i]! / norm;
      }
    }
    return vec;
  }
}

/** Embedder that can be toggled to fail after indexing completes. */
class ToggleFailingEmbedder implements Embedder {
  fail = false;
  private vocab = ['authenticate', 'authorize', 'validate', 'server', 'logger', 'function', 'export', 'class'];

  async embed(text: string): Promise<Float32Array> {
    if (this.fail) {
      throw new Error('Simulated embedder failure during search');
    }
    const vec = new Float32Array(this.vocab.length);
    const lower = text.toLowerCase();
    for (let i = 0; i < this.vocab.length; i++) {
      vec[i] = lower.includes(this.vocab[i]!) ? 1 : 0;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] = vec[i]! / norm;
      }
    }
    return vec;
  }
}

function setupTestDir(): void {
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });

  writeFileSync(
    join(TEST_DIR, 'src', 'auth.ts'),
    `
export function authenticate(token: string): boolean {
  return validateToken(token);
}

export function authorize(user: User, resource: string): boolean {
  return user.permissions.includes(resource);
}

function validateToken(token: string): boolean {
  return token.length > 0;
}
`.trim(),
  );

  writeFileSync(
    join(TEST_DIR, 'src', 'server.ts'),
    `
import { authenticate } from './auth.js';

export class HttpServer {
  constructor(private port: number) {}

  async start(): Promise<void> {
    console.log('Starting on port', this.port);
  }

  handleRequest(req: Request): Response {
    if (!authenticate(req.headers.get('auth') ?? '')) {
      return new Response('Unauthorized', { status: 401 });
    }
    return new Response('OK');
  }
}
`.trim(),
  );

  writeFileSync(
    join(TEST_DIR, 'src', 'logger.ts'),
    `
export function createLogger(name: string) {
  return {
    info: (msg: string) => console.log(\`[\${name}] \${msg}\`),
    error: (msg: string) => console.error(\`[\${name}] \${msg}\`),
  };
}
`.trim(),
  );
}

// Cleanup on exit
process.on('exit', () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── Helpers ──────────────────────────────────────────────

async function callCodeSearch(
  codeSearch: CodeSearchService,
  args: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
  const result = await handleToolCall(
    'code_search',
    args,
    {} as Router, // router not used by code_search
    {} as any, // vault not used by code_search
    undefined,
    undefined,
    undefined,
    codeSearch,
    undefined,
    undefined,
    'local-dev',
  );

  assert.ok(result.content);
  assert.ok(result.content.length > 0);
  const text = result.content[0]!.text;
  assert.ok(typeof text === 'string');
  return { text, isError: result.isError };
}

// ── Tests ────────────────────────────────────────────────

describe('MCP code_search tool — mode parameter', () => {
  let service: CodeSearchService;

  beforeEach(async () => {
    service = new CodeSearchService({ embedder: new MockEmbedder() });
    setupTestDir();
    await service.indexDirectory({ rootDir: TEST_DIR });
  });

  it('mode=keyword returns keyword search results', async () => {
    const { text } = await callCodeSearch(service, {
      query: 'authenticate',
      scope: TEST_DIR,
      mode: 'keyword',
    });

    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length > 0, 'Keyword should find results');
    assert.equal(parsed.count, parsed.results.length);

    const names = parsed.results.map((r: any) => r.name);
    assert.ok(names.includes('authenticate'), 'Should find authenticate function');
  });

  it('mode=vector returns semantic search results', async () => {
    const { text } = await callCodeSearch(service, {
      query: 'authenticate',
      scope: TEST_DIR,
      mode: 'vector',
    });

    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length > 0, 'Vector should find results');
    assert.equal(parsed.count, parsed.results.length);

    const names = parsed.results.map((r: any) => r.name);
    assert.ok(names.includes('authenticate'), 'Should find authenticate via vector search');
  });

  it('mode=hybrid returns fused results', async () => {
    const { text } = await callCodeSearch(service, {
      query: 'authenticate',
      scope: TEST_DIR,
      mode: 'hybrid',
    });

    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length > 0, 'Hybrid should find results');
    assert.equal(parsed.count, parsed.results.length);

    const names = parsed.results.map((r: any) => r.name);
    assert.ok(names.includes('authenticate'), 'Should include authenticate in hybrid');

    // Hybrid results should have rrfScore and methodCount
    for (const result of parsed.results) {
      assert.ok(
        'rrfScore' in result && typeof result.rrfScore === 'number',
        'Hybrid result should have rrfScore',
      );
      assert.ok(
        'methodCount' in result && typeof result.methodCount === 'number',
        'Hybrid result should have methodCount',
      );
    }
  });

  it('omitting mode defaults to keyword (backward compatibility)', async () => {
    const { text } = await callCodeSearch(service, {
      query: 'authenticate',
      scope: TEST_DIR,
      // intentionally no mode
    });

    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length > 0, 'Default mode should find results');

    const names = parsed.results.map((r: any) => r.name);
    assert.ok(names.includes('authenticate'), 'Default mode should find authenticate');
  });

  it('vector mode with failing embedder returns structured error', async () => {
    const embedder = new ToggleFailingEmbedder();
    const failingService = new CodeSearchService({ embedder });
    await failingService.indexDirectory({ rootDir: TEST_DIR });
    embedder.fail = true; // fail on query embed

    const { text, isError } = await callCodeSearch(failingService, {
      query: 'authenticate',
      scope: TEST_DIR,
      mode: 'vector',
    });

    assert.equal(isError, true, 'Should mark response as error');
    const parsed = JSON.parse(text);
    assert.ok(parsed.error, 'Should have error field');
    assert.ok(parsed.error.includes('Embedder failed in vector mode'), 'Error should mention vector mode');
    assert.ok(Array.isArray(parsed.results), 'Should have results array');
    assert.equal(parsed.results.length, 0, 'Results should be empty on error');
  });

  it('hybrid mode with failing embedder returns structured error', async () => {
    const embedder = new ToggleFailingEmbedder();
    const failingService = new CodeSearchService({ embedder });
    await failingService.indexDirectory({ rootDir: TEST_DIR });
    embedder.fail = true; // fail on query embed

    const { text, isError } = await callCodeSearch(failingService, {
      query: 'authenticate',
      scope: TEST_DIR,
      mode: 'hybrid',
    });

    assert.equal(isError, true, 'Should mark response as error');
    const parsed = JSON.parse(text);
    assert.ok(parsed.error, 'Should have error field');
    assert.ok(parsed.error.includes('Embedder failed in hybrid mode'), 'Error should mention hybrid mode');
    assert.ok(Array.isArray(parsed.results), 'Should have results array');
    assert.equal(parsed.results.length, 0, 'Results should be empty on error');
  });

  it('keyword mode with failing embedder still works (does not use embedder)', async () => {
    const embedder = new ToggleFailingEmbedder();
    const failingService = new CodeSearchService({ embedder });
    await failingService.indexDirectory({ rootDir: TEST_DIR });
    embedder.fail = true; // fail on query embed

    const { text, isError } = await callCodeSearch(failingService, {
      query: 'authenticate',
      scope: TEST_DIR,
      mode: 'keyword',
    });

    assert.ok(!isError, 'Keyword mode should not error even with broken embedder');
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length > 0, 'Keyword mode should still find results');
  });

  it('followImports=true works across all modes', async () => {
    const { text } = await callCodeSearch(service, {
      query: 'HttpServer',
      scope: TEST_DIR,
      mode: 'keyword',
      followImports: true,
    });

    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length > 0, 'Should find HttpServer');

    const httpServer = parsed.results.find((r: any) => r.name === 'HttpServer');
    if (httpServer && httpServer.related) {
      assert.ok(Array.isArray(httpServer.related), 'Related chunks should be array');
    }
  });
});
