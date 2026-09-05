import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { safeError, toSafeHttpError } from '../../src/core/safe-error.js';
import { VALID_PROVIDERS } from '../../src/core/constants.js';
import { registerStorageRoutes } from '../../src/server/routes/storage.js';
import type { Vault } from '../../src/vault/vault.js';

const CANARY = 'storage-private-exception-canary';
const INTERNAL_MESSAGE = toSafeHttpError(safeError('INTERNAL_ERROR')).body.error;
const routes = [
  { method: 'POST', path: '/v1/credentials', operation: 'store', status: 201,
    request: { provider: 'openai', apiKey: 'test-key', project: 'scope' },
    response: { id: 41, provider: 'openai', keyName: 'default', project: 'scope' },
    arguments: ['openai', 'default', 'test-key', 'scope'] },
  { method: 'GET', path: '/v1/credentials', operation: 'listMasked', status: 200,
    request: undefined, response: { credentials: [] }, arguments: ['scope'] },
  { method: 'POST', path: '/v1/files', operation: 'storeFile', status: 201,
    request: { provider: 'openai', fileName: 'fixture.txt', content: 'fixture', project: 'scope' },
    response: { id: 42, provider: 'openai', fileName: 'fixture.txt', project: 'scope' },
    arguments: ['openai', 'fixture.txt', 'fixture', 'scope'] },
  { method: 'GET', path: '/v1/files', operation: 'listFiles', status: 200,
    request: undefined, response: { files: [] }, arguments: ['scope'] },
] as const;

interface Invocation { operation: string; arguments: unknown[]; }
function appFor(failure?: () => never) {
  const calls: Invocation[] = [];
  function invoke(operation: string, args: unknown[]) {
    calls.push({ operation, arguments: args });
    if (failure) failure();
  }
  const vault: Pick<Vault, 'store' | 'listMasked' | 'storeFile' | 'listFiles'> = {
    store: (...args) => { invoke('store', args); return 41; },
    listMasked: (...args) => { invoke('listMasked', args); return []; },
    storeFile: (...args) => { invoke('storeFile', args); return 42; },
    listFiles: (...args) => { invoke('listFiles', args); return []; },
  };
  const app = new Hono();
  // Only POST/GET are exercised; no database constructor or DELETE substitute is used.
  registerStorageRoutes(app, { vault: vault as Vault });
  return { app, calls };
}

function request(route: (typeof routes)[number]): RequestInit {
  return { method: route.method, headers: { 'content-type': 'application/json', 'X-Project': 'scope' },
    ...(route.request ? { body: JSON.stringify(route.request) } : {}) };
}

describe('Storage POST/GET safe failure projection', () => {
  for (const route of routes) {
    for (const kind of ['error', 'non_error', 'message_getter', 'coercion'] as const) {
      it(`${route.method} ${route.path} hides ${kind} failures without inspecting their content`, async () => {
        let accesses = 0;
        let failure: unknown = kind === 'non_error' ? CANARY : new Error(CANARY);
        if (kind === 'message_getter') {
          Object.defineProperty(failure, 'message', { get() { accesses++; return CANARY; } });
        }
        if (kind === 'coercion') {
          failure = { get [Symbol.toPrimitive]() { accesses++; return () => { accesses++; return CANARY; }; } };
        }
        const { app, calls } = appFor(() => { throw failure; });
        const response = await app.request(route.path, request(route));
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.operation, route.operation);
        assert.equal(accesses, 0, 'Exception getters and coercion must not run');
        assert.equal(response.status, 500);
        const body = await response.json();
        assert.deepEqual(body, { error: INTERNAL_MESSAGE });
        assert.equal(JSON.stringify(body).includes(CANARY), false);
      });
    }

    it(`${route.method} ${route.path} preserves success and scoped Vault arguments`, async () => {
      const { app, calls } = appFor();
      const response = await app.request(route.path, request(route));
      assert.equal(response.status, route.status);
      assert.deepEqual(await response.json(), route.response);
      assert.deepEqual(calls, [{ operation: route.operation, arguments: [...route.arguments] }]);
    });
  }

  for (const path of ['/v1/credentials', '/v1/files']) {
    it(`POST ${path} preserves validation 400 without invoking Vault`, async () => {
      const { app, calls } = appFor(() => { throw new Error('Vault must not be called'); });
      const response = await app.request(path, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: toSafeHttpError(safeError('INVALID_REQUEST')).body.error,
        code: 'VALIDATION_ERROR', field: '',
        ...(path === '/v1/credentials' ? { validProviders: [...VALID_PROVIDERS] } : {}),
      });
      assert.deepEqual(calls, []);
    });
  }
});
