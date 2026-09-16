import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, describe, it } from 'node:test';

import { FakeCliChild } from './helpers/fake-cli-child.js';

const originalExecFile = childProcess.execFile;
const mutableChildProcess = childProcess as unknown as {
  execFile: (...args: unknown[]) => unknown;
};

afterEach(() => {
  mutableChildProcess.execFile = originalExecFile as unknown as (...args: unknown[]) => unknown;
  syncBuiltinESMExports();
  assert.strictEqual(childProcess.execFile, originalExecFile);
});

function installChild(child: FakeCliChild): void {
  mutableChildProcess.execFile = () => child;
  syncBuiltinESMExports();
}

function failure(error: unknown): { kind?: string; code?: string; stdout?: string; stderr?: string; message: string } {
  assert.ok(error instanceof Error);
  return error as { kind?: string; code?: string; stdout?: string; stderr?: string; message: string };
}

describe('execCliAsync lifecycle', () => {
  it('rejects caller cancellation without spawning an already-aborted command', async () => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');
    let spawnCount = 0;
    mutableChildProcess.execFile = () => {
      spawnCount += 1;
      return new FakeCliChild();
    };
    syncBuiltinESMExports();

    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      execCliAsync('mock', [], { signal: controller.signal }),
      (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'aborted');
        assert.equal(value.code, 'ABORT_ERR');
        return true;
      },
    );
    assert.equal(spawnCount, 0);
  });

  it('terminates a live caller-cancelled child and rejects only after close', async () => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');
    const child = new FakeCliChild();
    installChild(child);
    const controller = new AbortController();

    const pending = execCliAsync('mock', [], { signal: controller.signal });
    const rejected = assert.rejects(pending, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'aborted');
      assert.equal(value.code, 'ABORT_ERR');
      return true;
    });
    controller.abort();
    assert.deepEqual(child.killCalls, ['SIGTERM']);

    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => undefined);
    await Promise.resolve();
    assert.equal(settled, false, 'caller abort must wait for close');

    child.emitExit(0);
    child.emitClose(0);
    await rejected;
  });

  it('keeps the first timeout-or-caller termination cause through close', async (t) => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const callerFirst = new FakeCliChild();
      installChild(callerFirst);
      const callerController = new AbortController();
      const callerPending = execCliAsync('mock', [], { timeout: 10, signal: callerController.signal });
      const callerRejected = assert.rejects(callerPending, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'aborted');
        assert.equal(value.code, 'ABORT_ERR');
        return true;
      });
      callerController.abort();
      t.mock.timers.tick(10);
      assert.deepEqual(callerFirst.killCalls, ['SIGTERM']);
      callerFirst.emitClose(0);
      await callerRejected;

      const timeoutFirst = new FakeCliChild();
      installChild(timeoutFirst);
      const timeoutController = new AbortController();
      const timeoutPending = execCliAsync('mock', [], { timeout: 10, signal: timeoutController.signal });
      const timeoutRejected = assert.rejects(timeoutPending, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'termination');
        assert.equal(value.code, 'ETIMEDOUT');
        return true;
      });
      t.mock.timers.tick(10);
      timeoutController.abort();
      assert.deepEqual(timeoutFirst.killCalls, ['SIGTERM']);
      timeoutFirst.emitClose(0);
      await timeoutRejected;
    } finally {
      t.mock.timers.reset();
    }
  });

  it('retains cancellation through exit, removes its listener on close, and never signals an exited child', async () => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');
    const child = new FakeCliChild();
    installChild(child);
    let addCalls = 0;
    let removeCalls = 0;
    let abortListener: (() => void) | undefined;
    const signal = {
      aborted: false,
      addEventListener: (_event: string, listener: () => void) => {
        addCalls += 1;
        abortListener = listener;
      },
      removeEventListener: () => {
        removeCalls += 1;
      },
    } as unknown as AbortSignal;

    const pending = execCliAsync('mock', [], { signal });
    const rejected = assert.rejects(pending, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'aborted');
      assert.equal(value.code, 'ABORT_ERR');
      return true;
    });
    child.emitExit(0);
    abortListener?.();
    assert.deepEqual(child.killCalls, [], 'exit makes the direct child ineligible for signalling');
    child.emitClose(0);

    await rejected;
    assert.equal(addCalls, 1);
    assert.equal(removeCalls, 1, 'close releases the external cancellation listener');
  });

  it('settles from close with classified, retained diagnostics', async () => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');

    const successChild = new FakeCliChild();
    installChild(successChild);
    const success = execCliAsync('mock', [], { input: 'input' });
    assert.deepEqual(successChild.stdinWrites, ['input']);
    assert.equal(successChild.stdinEnded, true);
    successChild.emitStdout('ok');
    successChild.emitStderr('diagnostic');
    successChild.emitClose(0);
    assert.deepEqual(await success, { stdout: 'ok', stderr: 'diagnostic' });

    const exitChild = new FakeCliChild();
    installChild(exitChild);
    const nonzero = execCliAsync('mock', []);
    const nonzeroRejected = assert.rejects(nonzero, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'exit');
      assert.equal(value.stdout, 'partial');
      assert.equal(value.stderr, 'stderr [REDACTED_KEY]');
      assert.equal(value.message, 'Process exited with code 7');
      return true;
    });
    exitChild.emitStdout('partial');
    exitChild.emitStderr('stderr sk-ant-abcdefghijk');
    exitChild.emitClose(7);
    await nonzeroRejected;

    const killedChild = new FakeCliChild();
    installChild(killedChild);
    const killed = execCliAsync('mock', []);
    const killedRejected = assert.rejects(killed, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'termination');
      assert.equal(value.code, undefined);
      return true;
    });
    killedChild.killed = true;
    killedChild.emitClose(0);
    await killedRejected;

    const signaledChild = new FakeCliChild();
    installChild(signaledChild);
    const signaled = execCliAsync('mock', []);
    const signaledRejected = assert.rejects(signaled, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'termination');
      assert.equal(value.code, undefined);
      return true;
    });
    signaledChild.emitClose(0, 'SIGTERM');
    await signaledRejected;

    const abnormalChild = new FakeCliChild();
    installChild(abnormalChild);
    const abnormal = execCliAsync('mock', []);
    const abnormalRejected = assert.rejects(abnormal, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'termination');
      assert.equal(value.code, undefined);
      return true;
    });
    abnormalChild.emitClose(null);
    await abnormalRejected;

    const stdinErrorChild = new FakeCliChild();
    installChild(stdinErrorChild);
    const stdinError = execCliAsync('mock', []);
    const stdinRejected = assert.rejects(stdinError, (error: unknown) => {
      assert.equal(failure(error).kind, 'process_error');
      return true;
    });
    stdinErrorChild.stdin.emit('error', new Error('stdin write failed'));
    stdinErrorChild.emitClose(0);
    await stdinRejected;

    const processErrorChild = new FakeCliChild();
    installChild(processErrorChild);
    const processError = execCliAsync('mock', []);
    const processRejected = assert.rejects(processError, (error: unknown) => {
      const value = failure(error);
      assert.equal(value.kind, 'process_error');
      assert.equal(value.code, 'ETIMEDOUT');
      assert.equal(value.stdout, 'partial');
      assert.equal(value.stderr, 'stderr');
      assert.equal(value.message, 'CLI process error');
      return true;
    });
    const recorded = Object.assign(new Error('process sentinel'), { code: 'ETIMEDOUT' });
    processErrorChild.emitStdout('partial');
    processErrorChild.emitStderr('stderr');
    processErrorChild.emitProcessError(recorded);
    let settled = false;
    void processError.finally(() => { settled = true; }).catch(() => undefined);
    await Promise.resolve();
    assert.equal(settled, false, 'an error event must wait for close');
    processErrorChild.emitClose(0);
    await processRejected;
  });

  it('owns a deadline and escalates only a live direct child', async (t) => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const escalatingChild = new FakeCliChild();
      installChild(escalatingChild);
      const escalating = execCliAsync('mock', [], { timeout: 10 });
      const escalatingRejected = assert.rejects(escalating, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'termination');
        assert.equal(value.code, 'ETIMEDOUT');
        return true;
      });
      t.mock.timers.tick(10);
      t.mock.timers.tick(1_000);
      escalatingChild.emitExit(null, 'SIGKILL');
      escalatingChild.emitClose(null, 'SIGKILL');
      await escalatingRejected;
      assert.deepEqual(escalatingChild.killCalls, ['SIGTERM', 'SIGKILL']);
      assert.equal(escalatingChild.killed, true, 'killed is not a liveness signal');

      const exitedBeforeDeadline = new FakeCliChild();
      installChild(exitedBeforeDeadline);
      const exited = execCliAsync('mock', [], { timeout: 10 });
      exitedBeforeDeadline.emitExit(0);
      t.mock.timers.tick(10);
      assert.deepEqual(exitedBeforeDeadline.killCalls, []);
      exitedBeforeDeadline.emitClose(0);
      await assert.deepEqual(await exited, { stdout: '', stderr: '' });

      const exitedDuringGrace = new FakeCliChild();
      installChild(exitedDuringGrace);
      const grace = execCliAsync('mock', [], { timeout: 10 });
      const graceRejected = assert.rejects(grace, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'termination');
        assert.equal(value.code, 'ETIMEDOUT');
        return true;
      });
      t.mock.timers.tick(10);
      exitedDuringGrace.emitExit(0, 'SIGTERM');
      t.mock.timers.tick(1_000);
      assert.deepEqual(exitedDuringGrace.killCalls, ['SIGTERM']);
      let settled = false;
      void grace.finally(() => { settled = true; }).catch(() => undefined);
      await Promise.resolve();
      assert.equal(settled, false, 'exit alone must not settle before close');
      exitedDuringGrace.emitClose(0, 'SIGTERM');
      await graceRejected;
    } finally {
      t.mock.timers.reset();
    }
  });

  it('validates timeouts before spawn and preserves process-error priority', async (t) => {
    const { execCliAsync } = await import('../src/adapters/cli-utils.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let spawnCount = 0;
      mutableChildProcess.execFile = () => {
        spawnCount += 1;
        return new FakeCliChild();
      };
      syncBuiltinESMExports();
      await assert.rejects(execCliAsync('mock', [], { timeout: -1 }), RangeError);
      await assert.rejects(execCliAsync('mock', [], { timeout: Number.POSITIVE_INFINITY }), RangeError);
      assert.equal(spawnCount, 0);

      const noEscalation = new FakeCliChild();
      noEscalation.killResults.push(false);
      installChild(noEscalation);
      const falseKill = execCliAsync('mock', [], { timeout: 10 });
      const falseKillRejected = assert.rejects(falseKill, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'termination');
        assert.equal(value.code, 'ETIMEDOUT');
        return true;
      });
      t.mock.timers.tick(10);
      t.mock.timers.tick(1_000);
      assert.deepEqual(noEscalation.killCalls, ['SIGTERM']);
      noEscalation.emitClose(0);
      await falseKillRejected;

      const originalError = new FakeCliChild();
      originalError.throwOnKillSignal = 'SIGTERM';
      installChild(originalError);
      const preserved = execCliAsync('mock', [], { timeout: 10 });
      const preservedRejected = assert.rejects(preserved, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'process_error');
        assert.equal(value.code, 'EORIGINAL');
        return true;
      });
      originalError.emitProcessError(Object.assign(new Error('original process error'), { code: 'EORIGINAL' }));
      t.mock.timers.tick(10);
      assert.deepEqual(originalError.killCalls, ['SIGTERM']);
      originalError.emitClose(0);
      await preservedRejected;

      const disabledDeadline = new FakeCliChild();
      installChild(disabledDeadline);
      const disabled = execCliAsync('mock', [], { timeout: 0 });
      t.mock.timers.tick(120_001);
      assert.deepEqual(disabledDeadline.killCalls, []);
      disabledDeadline.emitClose(0);
      await assert.deepEqual(await disabled, { stdout: '', stderr: '' });

      const defaultDeadline = new FakeCliChild();
      installChild(defaultDeadline);
      const defaultTimeout = execCliAsync('mock', []);
      const defaultRejected = assert.rejects(defaultTimeout, (error: unknown) => {
        const value = failure(error);
        assert.equal(value.kind, 'termination');
        assert.equal(value.code, 'ETIMEDOUT');
        return true;
      });
      t.mock.timers.tick(120_000);
      assert.deepEqual(defaultDeadline.killCalls, ['SIGTERM']);
      defaultDeadline.emitClose(0);
      await defaultRejected;
    } finally {
      t.mock.timers.reset();
    }
  });
});
