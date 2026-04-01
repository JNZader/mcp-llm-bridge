/**
 * Tests for CodeSearchService.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CodeSearchService } from '../../src/code-search/searcher.js';

const TEST_DIR = join('/tmp', `code-search-test-${Date.now()}`);

function setupTestDir(): void {
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'src', 'utils'), { recursive: true });

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
    join(TEST_DIR, 'src', 'utils', 'logger.ts'),
    `
export function createLogger(name: string) {
  return {
    info: (msg: string) => console.log(\`[\${name}] \${msg}\`),
    error: (msg: string) => console.error(\`[\${name}] \${msg}\`),
  };
}

export interface LoggerConfig {
  level: string;
  pretty: boolean;
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

describe('CodeSearchService', () => {
  let service: CodeSearchService;

  beforeEach(() => {
    service = new CodeSearchService();
    setupTestDir();
  });

  it('indexes a directory and returns chunk count', () => {
    const chunks = service.indexDirectory({ rootDir: TEST_DIR });
    assert.ok(chunks > 0, `Expected chunks > 0, got ${chunks}`);
  });

  it('searches for functions by name', () => {
    service.indexDirectory({ rootDir: TEST_DIR });
    const results = service.search({ query: 'authenticate', scope: TEST_DIR });

    assert.ok(results.length > 0, 'Should find authenticate');
    assert.equal(results[0]!.name, 'authenticate');
  });

  it('searches for classes', () => {
    service.indexDirectory({ rootDir: TEST_DIR });
    const results = service.search({ query: 'HttpServer', scope: TEST_DIR });

    assert.ok(results.length > 0, 'Should find HttpServer');
    assert.equal(results[0]!.name, 'HttpServer');
    assert.equal(results[0]!.kind, 'class');
  });

  it('searches for interfaces', () => {
    service.indexDirectory({ rootDir: TEST_DIR });
    const results = service.search({ query: 'LoggerConfig', scope: TEST_DIR });

    assert.ok(results.length > 0, 'Should find LoggerConfig');
    assert.equal(results[0]!.name, 'LoggerConfig');
    assert.equal(results[0]!.kind, 'interface');
  });

  it('returns empty for empty query', () => {
    service.indexDirectory({ rootDir: TEST_DIR });
    const results = service.search({ query: '', scope: TEST_DIR });
    assert.equal(results.length, 0);
  });

  it('respects limit option', () => {
    service.indexDirectory({ rootDir: TEST_DIR });
    const results = service.search({ query: 'function', scope: TEST_DIR, limit: 2 });
    assert.ok(results.length <= 2, 'Should respect limit');
  });

  it('reindex forces fresh index', () => {
    service.indexDirectory({ rootDir: TEST_DIR });
    const count1 = service.indexSize;

    // Add a file
    writeFileSync(
      join(TEST_DIR, 'src', 'extra.ts'),
      'export function extra() { return true; }',
    );

    // Normal index would skip (TTL cache)
    service.indexDirectory({ rootDir: TEST_DIR });
    const count2 = service.indexSize;
    assert.equal(count2, count1, 'Should use cached index');

    // Reindex forces refresh
    service.reindex(TEST_DIR);
    const count3 = service.indexSize;
    assert.ok(count3 > count1, 'Reindex should find new file');
  });

  it('auto-indexes on first search if scope provided', () => {
    // Don't manually index — search should auto-index
    const results = service.search({ query: 'authenticate', scope: TEST_DIR });
    assert.ok(results.length > 0, 'Should auto-index and find results');
  });

  it('ignores node_modules by default', () => {
    mkdirSync(join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(
      join(TEST_DIR, 'node_modules', 'pkg', 'index.ts'),
      'export function secretPkg() { return true; }',
    );

    service.indexDirectory({ rootDir: TEST_DIR });
    const results = service.search({ query: 'secretPkg', scope: TEST_DIR });
    assert.equal(results.length, 0, 'Should not index node_modules');
  });
});
