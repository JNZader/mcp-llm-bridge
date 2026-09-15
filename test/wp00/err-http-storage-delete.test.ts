import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { Vault } from '../../src/vault/vault.js';
import { registerStorageRoutes } from '../../src/server/routes/storage.js';
import { safeError, toSafeHttpError } from '../../src/core/safe-error.js';

const CANARY = 'private-delete-project-canary';
const INTERNAL_MESSAGE = toSafeHttpError(safeError('INTERNAL_ERROR')).body.error;
const DENIED_MESSAGE = toSafeHttpError(safeError('ACCESS_DENIED')).body.error;
const resources = [
  { path: '/v1/credentials', method: 'delete',
    store: (vault: Vault, project?: string) => vault.store('openai', 'fixture', 'test-secret', project),
    remove: (vault: Vault, id: number, project?: string) => vault.delete(id, project),
    ids: (vault: Vault) => vault.listMasked().map((row) => row.id) },
  { path: '/v1/files', method: 'deleteFile',
    store: (vault: Vault, project?: string) => vault.storeFile('openai', 'fixture.txt', 'test-content', project),
    remove: (vault: Vault, id: number, project?: string) => vault.deleteFile(id, project),
    ids: (vault: Vault) => vault.listFiles().map((row) => row.id) },
] as const;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'wp00-storage-delete-'));
  let vault: Vault | undefined;
  t.after(() => {
    try { vault?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  vault = new Vault({ masterKey: randomBytes(32), dbPath: join(directory, 'vault.db'), httpPort: 0 });
  const app = new Hono();
  let escapedErrors = 0;
  // Distinguish a route projection from Hono's fallback; never stringify a hostile failure.
  app.onError((_error, c) => { escapedErrors++; return c.json({ unexpected_handler_failure: true }, 500); });
  registerStorageRoutes(app, { vault });
  return { app, vault, escapedErrors: () => escapedErrors };
}

function deletion(app: Hono, path: string, id: number, project?: string) {
  return app.request(`${path}/${id}`, { method: 'DELETE',
    headers: project === undefined ? undefined : { 'X-Project': project } });
}

describe('Storage DELETE trusted failure classification', () => {
  for (const resource of resources) {
    it(`${resource.path} preserves real Vault missing status without exposing identifiers`, async (t) => {
      const { app, vault } = fixture(t);
      const existing = resource.store(vault, CANARY);
      const response = await deletion(app, resource.path, 999999, CANARY);
      assert.deepEqual(resource.ids(vault), [existing]);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'The requested resource was not found.', code: 'NOT_FOUND' });
    });

    it(`${resource.path} preserves real Vault denial and the original row without exposing projects`, async (t) => {
      const { app, vault } = fixture(t);
      const id = resource.store(vault, CANARY);
      const response = await deletion(app, resource.path, id, 'another-project');
      assert.deepEqual(resource.ids(vault), [id]);
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.deepEqual(body, { error: DENIED_MESSAGE, code: 'UNAUTHORIZED' });
      assert.equal(JSON.stringify(body).includes(CANARY), false);
      assert.equal(JSON.stringify(body).includes('another-project'), false);
    });

    for (const global of [false, true]) {
      it(`${resource.path} preserves ${global ? 'global' : 'same-project'} authorized deletion`, async (t) => {
        const { app, vault } = fixture(t);
        const id = resource.store(vault, global ? undefined : CANARY);
        const response = await deletion(app, resource.path, id, CANARY);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        assert.deepEqual(resource.ids(vault), []);
      });
    }

    for (const kind of ['ordinary', 'fake_text', 'getter', 'coercion', 'hostile_proxy', 'revoked_proxy', 'wrapped_real_error'] as const) {
      it(`${resource.path} treats ${kind} as unknown without inspecting the thrown value`, async (t) => {
        const { app, vault, escapedErrors } = fixture(t);
        let accesses = 0;
        let failure: unknown = new Error(kind === 'fake_text' ? `Unauthorized not found ${CANARY}` : CANARY);
        if (kind === 'getter') Object.defineProperty(failure, 'message', { get() { accesses++; return CANARY; } });
        if (kind === 'coercion') {
          failure = { get [Symbol.toPrimitive]() { accesses++; return () => { accesses++; return CANARY; }; } };
        }
        if (kind === 'hostile_proxy') {
          failure = new Proxy({}, {
            get() { accesses++; throw new Error('Unexpected property inspection'); },
            getPrototypeOf() { accesses++; throw new Error('Unexpected prototype inspection'); },
          });
        }
        if (kind === 'revoked_proxy') {
          const revocable = Proxy.revocable({}, {});
          revocable.revoke();
          failure = revocable.proxy;
        }
        if (kind === 'wrapped_real_error') {
          let original: unknown;
          try { resource.remove(vault, 999999, CANARY); } catch (error) { original = error; }
          assert.ok(original && typeof original === 'object');
          failure = new Proxy(original, {});
        }
        // Fault injection only after genuine emitter tests; no typed-error module dependency.
        vault[resource.method] = () => { throw failure; };
        const response = await deletion(app, resource.path, 999999, CANARY);
        assert.equal(escapedErrors(), 0, 'The route must contain the error without Hono fallback');
        assert.equal(accesses, 0, 'No exception getters, prototype traps or coercion');
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: INTERNAL_MESSAGE });
      });
    }
  }
});
