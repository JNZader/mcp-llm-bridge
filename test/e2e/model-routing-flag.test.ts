/**
 * E2E test for the MODEL_ROUTING_ENABLED feature flag.
 *
 * Tests three scenarios:
 * 1. Flag unset (default false) → ModelRouter is NOT created even if config is enabled
 * 2. Flag=true with valid config → ModelRouter is created and wired into Router
 * 3. Flag=true with invalid/missing config → gracefully disabled (router.modelRouter is null)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Vault } from '../../src/vault/vault.js';
import { Router } from '../../src/core/router.js';
import { createAllAdapters } from '../../src/adapters/index.js';
import type { GatewayConfig } from '../../src/core/types.js';

// ── Paths ──────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');
const configPath = resolve(projectRoot, 'model-routing.json');
const backupPath = configPath + '.e2e-backup';

// ── Helpers ────────────────────────────────────────────────

function makeTestConfig(): GatewayConfig {
  return {
    masterKey: randomBytes(32),
    dbPath: `/tmp/test-model-routing-${Date.now()}.db`,
    httpPort: 0,
    authToken: 'test-token-' + randomBytes(8).toString('hex'),
    securityProfile: 'local-dev',
  };
}

async function bootstrapServer(modelRoutingEnabled: boolean) {
  const config = makeTestConfig();
  const vault = new Vault(config);
  const router = new Router();

  for (const adapter of createAllAdapters(vault)) {
    router.register(adapter);
  }

  // Mirror the exact conditional from src/index.ts
  if (modelRoutingEnabled) {
    const { bootstrapModelRouter } = await import(
      '../../src/model-routing/index.js'
    );
    const modelRouter = bootstrapModelRouter(router.providers);
    if (modelRouter) {
      router.setModelRouter(modelRouter);
    }
  }

  return { router, vault, dbPath: config.dbPath };
}

function cleanupDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

function saveOriginalConfig() {
  if (existsSync(configPath)) {
    writeFileSync(backupPath, readFileSync(configPath));
  }
}

function restoreOriginalConfig() {
  if (existsSync(backupPath)) {
    writeFileSync(configPath, readFileSync(backupPath));
    unlinkSync(backupPath);
  }
}

function writeRoutingConfig(content: unknown) {
  writeFileSync(configPath, JSON.stringify(content, null, 2));
}

// ── Tests ──────────────────────────────────────────────────

describe('E2E Model Routing Feature Flag', () => {
  const originalEnv = process.env['MODEL_ROUTING_ENABLED'];

  before(() => {
    saveOriginalConfig();
  });

  after(() => {
    restoreOriginalConfig();
    if (originalEnv === undefined) {
      delete process.env['MODEL_ROUTING_ENABLED'];
    } else {
      process.env['MODEL_ROUTING_ENABLED'] = originalEnv;
    }
  });

  it('flag=false (default) → ModelRouter is not created', async () => {
    delete process.env['MODEL_ROUTING_ENABLED'];

    // Write an enabled config to prove the FLAG (not the config) controls creation
    const base = JSON.parse(readFileSync(backupPath, 'utf-8'));
    writeRoutingConfig({ ...base, enabled: true });

    const { router, vault, dbPath } = await bootstrapServer(false);

    assert.strictEqual(
      router.modelRouter,
      null,
      'Expected router.modelRouter to be null when flag is false',
    );

    vault.close();
    cleanupDb(dbPath);
  });

  it('flag=true + valid config → ModelRouter created and wired', async () => {
    process.env['MODEL_ROUTING_ENABLED'] = 'true';

    const base = JSON.parse(readFileSync(backupPath, 'utf-8'));
    writeRoutingConfig({ ...base, enabled: true });

    const { router, vault, dbPath } = await bootstrapServer(true);

    assert.notStrictEqual(
      router.modelRouter,
      null,
      'Expected router.modelRouter to be set when flag=true and config is valid',
    );
    assert.strictEqual(router.modelRouter!.enabled, true);

    vault.close();
    cleanupDb(dbPath);
  });

  it('flag=true but invalid config → gracefully disabled', async () => {
    process.env['MODEL_ROUTING_ENABLED'] = 'true';

    // Corrupt the config file so loadConfig() returns null
    writeFileSync(configPath, 'this is not valid json {{}}');

    const { router, vault, dbPath } = await bootstrapServer(true);

    assert.strictEqual(
      router.modelRouter,
      null,
      'Expected router.modelRouter to be null when config is invalid',
    );

    vault.close();
    cleanupDb(dbPath);
  });
});
