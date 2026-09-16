import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { describe, it } from 'node:test';

import { DEFAULT_CLI_GENERATE_TIMEOUT_MS } from '../src/core/constants.js';
import { FakeCliChild } from './helpers/fake-cli-child.js';

const originalExecFile = childProcess.execFile;

function setExecFile(value: unknown): void {
  Object.defineProperty(childProcess, 'execFile', { configurable: true, value, writable: true });
  syncBuiltinESMExports();
}

function restoreExecFile(): void {
  setExecFile(originalExecFile);
  assert.strictEqual(childProcess.execFile, originalExecFile);
}

async function adapters() {
  const [{ BaseCliAdapter }, { CliOpenCodeAdapter }] = await Promise.all([
    import('../src/adapters/base-cli-adapter.js'), import('../src/adapters/cli-opencode.js'),
  ]);
  class TestBaseAdapter extends BaseCliAdapter {
    readonly config = { id: 'test-base', name: 'Test Base', cliCommand: 'test-base-cli', defaultModel: 'base-model', models: [] };
    protected buildArgs(): string[] { return ['run']; }
    protected parseResponse(output: string): string {
      if (output === 'STRUCTURED_FAILURE') throw new Error('structured parser failure sentinel');
      return `base:${output}`;
    }
  }
  const vault = Object.create(null);
  vault.getProviderFiles = () => [];
  vault.getFile = () => undefined;
  return { base: new TestBaseAdapter(vault), openCode: new CliOpenCodeAdapter(vault) };
}

function makeSpawner(plans: Array<(child: FakeCliChild) => void>): () => FakeCliChild {
  return () => {
    const plan = plans.shift();
    assert.ok(plan, 'every request has a controlled child plan');
    const child = new FakeCliChild();
    queueMicrotask(() => plan(child));
    return child;
  };
}

describe('Base and OpenCode asynchronous recovery boundaries', () => {
  it('rejects an OpenCode pre-abort before Vault or child execution', async () => {
    let vaultCalls = 0;
    let childCalls = 0;
    setExecFile(() => { childCalls += 1; return new FakeCliChild(); });
    try {
      const { CliOpenCodeAdapter } = await import('../src/adapters/cli-opencode.js');
      const vault = Object.create(null);
      vault.getFile = () => { vaultCalls += 1; return 'synthetic'; };
      const adapter = new CliOpenCodeAdapter(vault);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(adapter.generate({ prompt: 'cancel before spawn' }, { signal: controller.signal }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'AbortError');
        assert.equal(Reflect.get(error, 'code'), 'ABORT_ERR');
        return true;
      });
      assert.equal(vaultCalls, 0);
      assert.equal(childCalls, 0);
    } finally {
      restoreExecFile();
    }
  });

  it('uses a real helper deadline for Base timeout and preserves OpenCode legacy ETIMEDOUT behavior', async (t) => {
    const { base, openCode } = await adapters();
    const timeoutChild = new FakeCliChild();
    setExecFile(() => timeoutChild);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const timedOut = base.generate({ prompt: 'deadline' });
      const timeoutRejected = assert.rejects(timedOut, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Test Base CLI timed out');
        assert.doesNotMatch(error.message, /PARTIAL_SENTINEL/);
        return true;
      });
      timeoutChild.emitStdout('BASE_PARTIAL_SENTINEL');
      t.mock.timers.tick(DEFAULT_CLI_GENERATE_TIMEOUT_MS);
      timeoutChild.emitClose(0);
      await timeoutRejected;

      setExecFile(makeSpawner([child => {
        child.emitStdout('{"type":"text","part":{"text":"OPEN_PARTIAL_SENTINEL"}}\n');
        child.emitProcessError(Object.assign(new Error('source-message-sentinel argv-secret env-secret'), { code: 'ETIMEDOUT' }));
        child.emitClose(1);
      }]));
      const legacyRejected = assert.rejects(openCode.generate({ prompt: 'legacy' }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'OpenCode CLI timed out');
        assert.doesNotMatch(error.message, /PARTIAL_SENTINEL|source-message-sentinel|argv-secret|env-secret/);
        return true;
      });
      await legacyRejected;
    } finally {
      t.mock.timers.reset();
      restoreExecFile();
    }
  });

  it('keeps Base generic for process errors even when their original code is ETIMEDOUT', async () => {
    const { base, openCode } = await adapters();
    setExecFile(makeSpawner([
      child => {
        child.emitStdout('BASE_PROCESS_PARTIAL');
        child.emitProcessError(Object.assign(new Error('base process sentinel'), { code: 'ETIMEDOUT' }));
        child.emitClose(1);
      },
      child => {
        child.emitStdout('{"type":"text","part":{"text":"OPEN_PROCESS_PARTIAL"}}\n');
        child.emitProcessError(Object.assign(new Error('open process sentinel'), { code: 'ETIMEDOUT' }));
        child.emitClose(1);
      },
    ]));
    try {
      await assert.rejects(base.generate({ prompt: 'base process error' }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Test Base CLI failed: CLI process error');
        assert.doesNotMatch(error.message, /timed out|BASE_PROCESS_PARTIAL/);
        return true;
      });
      await assert.rejects(openCode.generate({ prompt: 'open process error' }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'OpenCode CLI timed out');
        assert.doesNotMatch(error.message, /OPEN_PROCESS_PARTIAL/);
        return true;
      });
    } finally {
      restoreExecFile();
    }
  });

  it('retains exact success, ordinary EXIT recovery, message-only behavior, generic failure, and parser diagnostics', async () => {
    const { base, openCode } = await adapters();
    setExecFile(makeSpawner([
      child => { child.emitStdout('BASE_SUCCESS_SENTINEL'); child.emitClose(0); },
      child => { child.emitStdout('{"type":"text","part":{"text":"OPEN_SUCCESS_SENTINEL"}}\n'); child.emitClose(0); },
      child => { child.emitStdout('BASE_RECOVERED_SENTINEL'); child.emitClose(1); },
      child => { child.emitStdout('{"type":"text","part":{"text":"OPEN_RECOVERED_SENTINEL"}}\n'); child.emitClose(1); },
      child => {
        child.emitStdout('BASE_MESSAGE_ONLY_SENTINEL');
        child.emitProcessError(new Error('ETIMEDOUT only in the message'));
        child.emitClose(1);
      },
      child => {
        child.emitStdout('{"type":"text","part":{"text":"OPEN_MESSAGE_ONLY_SENTINEL"}}\n');
        child.emitProcessError(new Error('ETIMEDOUT only in the message'));
        child.emitClose(1);
      },
      child => { child.emitProcessError(new Error('base generic failure sentinel')); child.emitClose(1); },
      child => { child.emitProcessError(new Error('open generic failure sentinel')); child.emitClose(1); },
      child => { child.emitStdout('STRUCTURED_FAILURE'); child.emitClose(1); },
    ]));
    try {
      assert.equal((await base.generate({ prompt: 'success' })).text, 'base:BASE_SUCCESS_SENTINEL');
      assert.equal((await openCode.generate({ prompt: 'success' })).text, 'OPEN_SUCCESS_SENTINEL');
      assert.equal((await base.generate({ prompt: 'recover' })).text, 'base:BASE_RECOVERED_SENTINEL');
      assert.equal((await openCode.generate({ prompt: 'recover' })).text, 'OPEN_RECOVERED_SENTINEL');
      await assert.rejects(base.generate({ prompt: 'message only' }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Test Base CLI failed: CLI process error');
        assert.doesNotMatch(error.message, /timed out|BASE_MESSAGE_ONLY_SENTINEL/);
        return true;
      });
      await assert.rejects(openCode.generate({ prompt: 'message only' }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'OpenCode CLI failed: CLI process error');
        assert.doesNotMatch(error.message, /timed out|OPEN_MESSAGE_ONLY_SENTINEL/);
        return true;
      });
      await assert.rejects(base.generate({ prompt: 'base generic' }), /Test Base CLI failed: CLI process error/);
      await assert.rejects(openCode.generate({ prompt: 'open generic' }), { message: 'OpenCode CLI failed: CLI process error' });
      await assert.rejects(base.generate({ prompt: 'structured failure' }), /Test Base CLI failed: structured parser failure sentinel/);
    } finally {
      restoreExecFile();
    }
  });
});
