import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { describe, it } from 'node:test';

import { DEFAULT_CLI_GENERATE_TIMEOUT_MS } from '../src/core/constants.js';
import { FakeCliChild } from './helpers/fake-cli-child.js';

const originalSpawn = childProcess.spawn;
const originalExecFileSync = childProcess.execFileSync;

function replaceSpawn(value: unknown): void {
  Object.defineProperty(childProcess, 'spawn', { configurable: true, value, writable: true });
  syncBuiltinESMExports();
}

function replaceSpawnSync(value: unknown): void {
  Object.defineProperty(childProcess, 'execFileSync', { configurable: true, value, writable: true });
  syncBuiltinESMExports();
}

function restoreChildProcess(): void {
  replaceSpawn(originalSpawn);
  replaceSpawnSync(originalExecFileSync);
  assert.strictEqual(childProcess.spawn, originalSpawn);
  assert.strictEqual(childProcess.execFileSync, originalExecFileSync);
}

async function makeAdapter(getProviderFiles: () => Array<{ fileName: string; content: string }> = () => []) {
  const { BaseCliAdapter } = await import('../src/adapters/base-cli-adapter.js');
  class TestAdapter extends BaseCliAdapter {
    readonly config = {
      id: 'base-cancel', name: 'Base Cancel', cliCommand: 'base-cancel', defaultModel: 'test-model', models: [], supportsSystemPrompt: true,
    };
    protected buildArgs(model: string): string[] {
      return ['run', model];
    }
    protected parseResponse(output: string): string { return `parsed:${output}`; }
  }
  const vault = Object.create(null);
  vault.getProviderFiles = getProviderFiles;
  return new TestAdapter(vault);
}

function assertAbort(error: unknown): true {
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'AbortError');
  assert.equal(Reflect.get(error, 'code'), 'ABORT_ERR');
  assert.doesNotMatch(error.message, /caller-secret|partial/i);
  return true;
}

describe('BaseCliAdapter asynchronous cancellation', () => {
  it('rejects a pre-aborted request before Vault and child execution', async () => {
    let vaultCalls = 0;
    let childCalls = 0;
    replaceSpawn(() => { childCalls += 1; return new FakeCliChild(); });
    try {
      const adapter = await makeAdapter(() => { vaultCalls += 1; return []; });
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(() => adapter.generate({ prompt: 'cancel' }, { signal: controller.signal }), assertAbort);
      assert.equal(vaultCalls, 0);
      assert.equal(childCalls, 0);
    } finally {
      restoreChildProcess();
    }
  });

  it('honors an abort that occurs inside Vault before a child or credential mount is created', async () => {
    const controller = new AbortController();
    let childCalls = 0;
    let mountFsCalls = 0;
    const originals = {
      chmodSync: fs.chmodSync,
      mkdirSync: fs.mkdirSync,
      mkdtempSync: fs.mkdtempSync,
      rmSync: fs.rmSync,
      writeFileSync: fs.writeFileSync,
    };
    const isProviderRoot = (path: unknown): boolean => typeof path === 'string'
      && (path === '/tmp/llm-gw' || path.startsWith('/tmp/llm-gw/'));
    const denyProviderRoot = (original: Function) => (...args: unknown[]) => {
      if (isProviderRoot(args[0])) {
        mountFsCalls += 1;
        throw new Error('provider-root filesystem access is forbidden in this regression test');
      }
      return Reflect.apply(original, fs, args);
    };
    replaceSpawn(() => { childCalls += 1; return new FakeCliChild(); });
    Object.defineProperty(fs, 'mkdirSync', { configurable: true, value: denyProviderRoot(originals.mkdirSync), writable: true });
    Object.defineProperty(fs, 'mkdtempSync', { configurable: true, value: denyProviderRoot(originals.mkdtempSync), writable: true });
    Object.defineProperty(fs, 'chmodSync', { configurable: true, value: denyProviderRoot(originals.chmodSync), writable: true });
    Object.defineProperty(fs, 'writeFileSync', { configurable: true, value: denyProviderRoot(originals.writeFileSync), writable: true });
    Object.defineProperty(fs, 'rmSync', { configurable: true, value: denyProviderRoot(originals.rmSync), writable: true });
    syncBuiltinESMExports();
    try {
      const adapter = await makeAdapter(() => {
        controller.abort('caller-secret');
        return [{ fileName: 'auth.json', content: 'synthetic' }];
      });
      await assert.rejects(() => adapter.generate({ prompt: 'cancel' }, { signal: controller.signal }), assertAbort);
      assert.equal(childCalls, 0);
      assert.equal(mountFsCalls, 0);
    } finally {
      Object.defineProperty(fs, 'mkdirSync', { configurable: true, value: originals.mkdirSync, writable: true });
      Object.defineProperty(fs, 'mkdtempSync', { configurable: true, value: originals.mkdtempSync, writable: true });
      Object.defineProperty(fs, 'chmodSync', { configurable: true, value: originals.chmodSync, writable: true });
      Object.defineProperty(fs, 'writeFileSync', { configurable: true, value: originals.writeFileSync, writable: true });
      Object.defineProperty(fs, 'rmSync', { configurable: true, value: originals.rmSync, writable: true });
      syncBuiltinESMExports();
      restoreChildProcess();
    }
  });

  it('keeps an active cancellation pending until close and never recovers partial stdout', async () => {
    const child = new FakeCliChild();
    replaceSpawn(() => child);
    try {
      const adapter = await makeAdapter();
      const controller = new AbortController();
      const pending = adapter.generate({ prompt: 'cancel' }, { signal: controller.signal });
      const rejected = assert.rejects(pending, assertAbort);
      child.emitStdout('partial output');
      controller.abort('caller-secret');
      assert.deepEqual(child.killCalls, ['SIGTERM']);
      let settled = false;
      void pending.finally(() => { settled = true; }).catch(() => undefined);
      await Promise.resolve();
      assert.equal(settled, false);
      child.emitExit(0);
      await Promise.resolve();
      assert.equal(settled, false, 'exit alone is not settlement');
      child.emitClose(0);
      await rejected;
    } finally {
      restoreChildProcess();
    }
  });

  it('checks the caller signal again after async close before parsing output', async () => {
    const child = new FakeCliChild();
    replaceSpawn(() => child);
    try {
      const adapter = await makeAdapter();
      const controller = new AbortController();
      const pending = adapter.generate({ prompt: 'barrier' }, { signal: controller.signal });
      const rejected = assert.rejects(pending, assertAbort);
      child.emitStdout('would-be-success');
      child.emitClose(0);
      controller.abort();
      await rejected;
    } finally {
      restoreChildProcess();
    }
  });

  it('maps only the internal default deadline to the exact timeout message', async (t) => {
    const child = new FakeCliChild();
    replaceSpawn(() => child);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const adapter = await makeAdapter();
      const pending = adapter.generate({ prompt: 'deadline' });
      const timeoutRejected = assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Base Cancel CLI timed out');
        assert.doesNotMatch(error.message, /partial/i);
        return true;
      });
      child.emitStdout('partial deadline output');
      t.mock.timers.tick(DEFAULT_CLI_GENERATE_TIMEOUT_MS);
      assert.deepEqual(child.killCalls, ['SIGTERM']);
      child.emitClose(0);
      await timeoutRejected;

      const external = new FakeCliChild();
      replaceSpawn(() => external);
      const externalPending = adapter.generate({ prompt: 'external termination' });
      const externalRejected = assert.rejects(externalPending, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Base Cancel CLI failed: Process terminated before completion');
        assert.doesNotMatch(error.message, /timed out|external partial/i);
        return true;
      });
      external.emitStdout('external partial');
      external.emitClose(null, 'SIGTERM');
      await externalRejected;
    } finally {
      t.mock.timers.reset();
      restoreChildProcess();
    }
  });

  it('preserves commands, system prompts, supplied environment, and response metadata on success', async () => {
    const child = new FakeCliChild();
    const calls: unknown[][] = [];
    replaceSpawn((...args: unknown[]) => { calls.push(args); queueMicrotask(() => { child.emitStdout('answer'); child.emitClose(0); }); return child; });
    try {
      const adapter = await makeAdapter();
      const response = await adapter.generate({ prompt: 'user', system: 'system', model: 'chosen-model' });
      assert.deepEqual(calls[0]?.slice(0, 2), ['base-cancel', ['run', 'chosen-model']]);
      assert.deepEqual(child.stdinWrites, ['system\n\nuser']);
      assert.equal(child.stdinEnded, true);
      const options = calls[0]?.[2];
      assert.ok(typeof options === 'object' && options !== null);
      const env = Reflect.get(options, 'env');
      assert.ok(typeof env === 'object' && env !== null);
      assert.equal(Reflect.get(env, 'HOME'), process.env.HOME);
      assert.deepEqual(response, {
        text: 'parsed:answer', provider: 'base-cancel', model: 'chosen-model', tokensUsed: 0,
        resolvedProvider: 'base-cancel', resolvedModel: 'chosen-model', fallbackUsed: false,
      });
    } finally {
      restoreChildProcess();
    }
  });

  it('lets all inherited concrete adapters reject pre-abort without Vault or child execution', async () => {
    let childCalls = 0;
    replaceSpawn(() => { childCalls += 1; return new FakeCliChild(); });
    try {
      const [{ ClaudeCliAdapter }, { CodexCliAdapter }, { QwenCliAdapter }, { AntigravityCliAdapter }] = await Promise.all([
        import('../src/adapters/cli-claude.js'), import('../src/adapters/cli-codex.js'),
        import('../src/adapters/cli-qwen.js'), import('../src/adapters/cli-antigravity.js'),
      ]);
      const constructors = [ClaudeCliAdapter, CodexCliAdapter, QwenCliAdapter, AntigravityCliAdapter];
      for (const Adapter of constructors) {
        const controller = new AbortController();
        controller.abort();
        const vault = Object.create(null);
        vault.getProviderFiles = () => { throw new Error('Vault must not be called'); };
        const adapter = new Adapter(vault);
        await assert.rejects(() => adapter.generate({ prompt: 'pre-abort' }, { signal: controller.signal }), assertAbort);
      }
      assert.equal(childCalls, 0);
    } finally {
      restoreChildProcess();
    }
  });
});
