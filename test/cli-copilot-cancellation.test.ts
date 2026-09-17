import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { describe, it } from 'node:test';

import type { Vault } from '../src/vault/vault.js';
import { FakeCliChild } from './helpers/fake-cli-child.js';

const originalSpawn = childProcess.spawn;
const originalExecFileSync = childProcess.execFileSync;
const TOKEN_KEYS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

type ChildPlan = (child: FakeCliChild) => void;

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

function assertAbort(error: unknown): true {
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'AbortError');
  assert.equal(Reflect.get(error, 'code'), 'ABORT_ERR');
  assert.doesNotMatch(error.message, /caller-secret|partial/i);
  return true;
}

function assertFailure(error: unknown, kind: string, code?: string): true {
  assert.ok(error instanceof Error);
  assert.equal(Reflect.get(error, 'kind'), kind);
  assert.equal(Reflect.get(error, 'code'), code);
  assert.doesNotMatch(error.message, /partial/i);
  return true;
}

function makeVault(getDecrypted: () => string): Vault {
  return { getDecrypted } as unknown as Vault;
}

function installPlans(plans: ChildPlan[]): { calls: unknown[][]; childCount: () => number } {
  const calls: unknown[][] = [];
  let count = 0;
  replaceSpawn((...args: unknown[]) => {
    count += 1;
    calls.push(args);
    const plan = plans.shift();
    assert.ok(plan, 'every request must have a controlled fake child');
    const child = new FakeCliChild();
    queueMicrotask(() => plan(child));
    return child;
  });
  return { calls, childCount: () => count };
}

async function makeAdapter(vault: Vault) {
  const { CopilotCliAdapter } = await import('../src/adapters/cli-copilot.js');
  return new CopilotCliAdapter(vault);
}

describe('CopilotCliAdapter asynchronous cancellation', () => {
  it('rejects a pre-aborted request before Vault and child execution', async () => {
    let vaultCalls = 0;
    let asyncChildCalls = 0;
    let syncChildCalls = 0;
    replaceSpawn(() => { asyncChildCalls += 1; return new FakeCliChild(); });
    replaceSpawnSync(() => { syncChildCalls += 1; return ''; });
    try {
      const adapter = await makeAdapter(makeVault(() => { vaultCalls += 1; return 'synthetic-token'; }));
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(() => adapter.generate({ prompt: 'cancel' }, { signal: controller.signal }), assertAbort);
      assert.equal(vaultCalls, 0);
      assert.equal(asyncChildCalls, 0);
      assert.equal(syncChildCalls, 0);
    } finally {
      restoreChildProcess();
    }
  });

  it('does not spawn after cancellation occurs during Vault return or Vault failure', async () => {
    const controller = new AbortController();
    let childCalls = 0;
    replaceSpawn(() => { childCalls += 1; return new FakeCliChild(); });
    replaceSpawnSync(() => { throw new Error('Copilot must not use synchronous execution'); });
    try {
      const returnAdapter = await makeAdapter(makeVault(() => {
        controller.abort('caller-secret');
        return 'synthetic-token';
      }));
      await assert.rejects(() => returnAdapter.generate({ prompt: 'vault return' }, { signal: controller.signal }), assertAbort);

      const throwController = new AbortController();
      const throwAdapter = await makeAdapter(makeVault(() => {
        throwController.abort('caller-secret');
        throw new Error('synthetic Vault failure');
      }));
      await assert.rejects(() => throwAdapter.generate({ prompt: 'vault throw' }, { signal: throwController.signal }), assertAbort);
      assert.equal(childCalls, 0);
    } finally {
      restoreChildProcess();
    }
  });

  it('keeps caller cancellation pending through close and never returns partial stdout', async () => {
    const child = new FakeCliChild();
    replaceSpawn(() => child);
    replaceSpawnSync(() => { throw new Error('Copilot must not use synchronous execution'); });
    try {
      const adapter = await makeAdapter(makeVault(() => 'synthetic-token'));
      const controller = new AbortController();
      const pending = adapter.generate({ prompt: 'cancel' }, { signal: controller.signal });
      const rejected = assert.rejects(pending, assertAbort);
      child.emitStdout('partial stdout');
      controller.abort('caller-secret');
      assert.deepEqual(child.killCalls, ['SIGTERM']);
      let settled = false;
      void pending.finally(() => { settled = true; }).catch(() => undefined);
      await Promise.resolve();
      assert.equal(settled, false);
      child.emitExit(0);
      await Promise.resolve();
      assert.equal(settled, false, 'exit alone must not settle the generation');
      child.emitClose(0);
      await rejected;
    } finally {
      restoreChildProcess();
    }
  });

  it('checks cancellation after close before returning a successful response', async () => {
    const child = new FakeCliChild();
    replaceSpawn(() => child);
    replaceSpawnSync(() => { throw new Error('Copilot must not use synchronous execution'); });
    try {
      const adapter = await makeAdapter(makeVault(() => 'synthetic-token'));
      const controller = new AbortController();
      const pending = adapter.generate({ prompt: 'barrier' }, { signal: controller.signal });
      const rejected = assert.rejects(pending, assertAbort);
      child.emitStdout('would-be-success');
      child.emitClose(0);
      controller.abort('caller-secret');
      await rejected;
    } finally {
      restoreChildProcess();
    }
  });

  it('preserves exact arguments, defaults, environment aliases, and response metadata on success', async () => {
    for (const key of TOKEN_KEYS) assert.equal(process.env[key], undefined, `clean test environment must not predefine ${key}`);
    for (const [index, key] of TOKEN_KEYS.entries()) process.env[key] = `preinstalled-${index}`;
    replaceSpawnSync(() => { throw new Error('Copilot must not use synchronous execution'); });
    const { calls, childCount } = installPlans([
      child => { child.emitStdout(' selected answer '); child.emitClose(0); },
      child => { child.emitStdout('default answer'); child.emitClose(0); },
    ]);
    try {
      const adapter = await makeAdapter(makeVault(() => 'vault-token'));
      const selected = await adapter.generate({ prompt: 'user prompt', system: 'system prompt', model: 'chosen-model' });
      const defaulted = await adapter.generate({ prompt: 'default prompt' });
      assert.equal(childCount(), 2);
      const selectedArgs = calls[0]?.[1];
      const defaultArgs = calls[1]?.[1];
      assert.ok(Array.isArray(selectedArgs) && Array.isArray(defaultArgs));
      assert.equal(selectedArgs[0], '-p');
      assert.equal(typeof selectedArgs[1], 'string');
      assert.match(selectedArgs[1] as string, /^@\S*mcp-copilot-prompt-/);
      assert.deepEqual(selectedArgs.slice(2), ['--model', 'chosen-model', '--allow-all-tools', '--deny-tool=shell', '--deny-tool=write', '--disable-builtin-mcps']);
      assert.equal(defaultArgs[0], '-p');
      assert.match(defaultArgs[1] as string, /^@\S*mcp-copilot-prompt-/);
      assert.deepEqual(defaultArgs.slice(2), ['--model', 'gpt-4.1', '--allow-all-tools', '--deny-tool=shell', '--deny-tool=write', '--disable-builtin-mcps']);
      const options = calls[0]?.[2];
      assert.ok(typeof options === 'object' && options !== null);
      const env = Reflect.get(options, 'env');
      assert.ok(typeof env === 'object' && env !== null);
      for (const key of TOKEN_KEYS) assert.equal(Reflect.get(env, key), 'vault-token');
      assert.equal(Reflect.get(options, 'signal'), undefined);
      assert.deepEqual(selected, {
        text: 'selected answer', provider: 'copilot-cli', model: 'chosen-model', tokensUsed: 0,
        resolvedProvider: 'copilot-cli', resolvedModel: 'chosen-model', fallbackUsed: false,
      });
      assert.deepEqual(defaulted, {
        text: 'default answer', provider: 'copilot-cli', model: 'gpt-4.1', tokensUsed: 0,
        resolvedProvider: 'copilot-cli', resolvedModel: 'gpt-4.1', fallbackUsed: false,
      });
    } finally {
      for (const key of TOKEN_KEYS) delete process.env[key];
      restoreChildProcess();
    }
  });

  it('keeps preinstalled synthetic aliases when Vault authentication fails', async () => {
    for (const key of TOKEN_KEYS) assert.equal(process.env[key], undefined, `clean test environment must not predefine ${key}`);
    for (const [index, key] of TOKEN_KEYS.entries()) process.env[key] = `preinstalled-${index}`;
    replaceSpawnSync(() => { throw new Error('Copilot must not use synchronous execution'); });
    const { calls } = installPlans([child => { child.emitStdout('fallback answer'); child.emitClose(0); }]);
    try {
      const adapter = await makeAdapter(makeVault(() => { throw new Error('synthetic Vault failure'); }));
      assert.equal((await adapter.generate({ prompt: 'fallback' })).text, 'fallback answer');
      const options = calls[0]?.[2];
      assert.ok(typeof options === 'object' && options !== null);
      const env = Reflect.get(options, 'env');
      assert.ok(typeof env === 'object' && env !== null);
      for (const [index, key] of TOKEN_KEYS.entries()) assert.equal(Reflect.get(env, key), `preinstalled-${index}`);
    } finally {
      for (const key of TOKEN_KEYS) delete process.env[key];
      restoreChildProcess();
    }
  });

  it('preserves helper lifecycle classifications for deadline, external termination, and process errors', async (t) => {
    replaceSpawnSync(() => { throw new Error('Copilot must not use synchronous execution'); });
    const timeoutChild = new FakeCliChild();
    replaceSpawn(() => timeoutChild);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const adapter = await makeAdapter(makeVault(() => 'synthetic-token'));
      const timedOut = adapter.generate({ prompt: 'deadline' });
      const timeoutRejected = assert.rejects(timedOut, (error: unknown) => assertFailure(error, 'termination', 'ETIMEDOUT'));
      timeoutChild.emitStdout('partial deadline stdout');
      t.mock.timers.tick(120_000);
      assert.deepEqual(timeoutChild.killCalls, ['SIGTERM']);
      timeoutChild.emitClose(0);
      await timeoutRejected;

      const externalChild = new FakeCliChild();
      replaceSpawn(() => externalChild);
      const externallyTerminated = adapter.generate({ prompt: 'external termination' });
      const externalRejected = assert.rejects(externallyTerminated, (error: unknown) => assertFailure(error, 'termination'));
      externalChild.emitStdout('partial external stdout');
      externalChild.emitClose(null, 'SIGTERM');
      await externalRejected;

      const processErrorChild = new FakeCliChild();
      replaceSpawn(() => processErrorChild);
      const processFailed = adapter.generate({ prompt: 'process error' });
      const processRejected = assert.rejects(processFailed, (error: unknown) => assertFailure(error, 'process_error', 'EPIPE'));
      processErrorChild.emitStdout('partial process stdout');
      processErrorChild.emitProcessError(Object.assign(new Error('synthetic process failure'), { code: 'EPIPE' }));
      processErrorChild.emitClose(1);
      await processRejected;
    } finally {
      t.mock.timers.reset();
      restoreChildProcess();
    }
  });
});
