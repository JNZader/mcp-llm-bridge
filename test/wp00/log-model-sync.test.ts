import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { describe, it, type TestContext } from 'node:test';
import { createLogger, logger } from '../../src/core/logger.js';
import { ModelSyncManager, ModelSyncAlreadyRunningError } from '../../src/model-sync/sync-manager.js';
import type { ModelSyncConfig, ModelSyncResult } from '../../src/model-sync/types.js';

const CANARY = 'private-model-sync-log-canary';
const CONFIG: ModelSyncConfig = {
  provider: 'openai', baseUrl: 'https://invalid.test/' + CANARY,
  apiKey: CANARY, autoSyncIntervalMs: 5000,
};
const SUCCESS: ModelSyncResult = {
  provider: 'openai', timestamp: 123, modelsFound: [], modelsAdded: [], modelsRemoved: [],
};

interface Scheduled {
  callback: () => unknown;
  delay: number | undefined;
  timer: ReturnType<typeof setTimeout>;
}

async function fixture(
  t: TestContext,
  sync: () => Promise<ModelSyncResult>,
  run: (manager: ModelSyncManager, queue: Scheduled[], output: string[], raw: string[]) => Promise<void>,
) {
  const raw: string[] = [];
  const output: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) { raw.push(chunk.toString()); done(); },
  });
  // Preserve Node Console formatting on the baseline path; do not feed errors
  // through Pino redaction before observing what the current console emits.
  const realConsole = new Console({ stdout: destination, stderr: destination });
  const pino = createLogger({ pretty: false, level: 'trace' }, {
    write(line: string) { output.push(line); },
  });
  const consoleMock = t.mock.method(console, 'error', realConsole.error.bind(realConsole));
  const loggerMock = t.mock.method(logger, 'error', pino.error.bind(pino));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const allocateTimer = globalThis.setTimeout;
  const queue: Scheduled[] = [];
  const scheduler = t.mock.method(globalThis, 'setTimeout', (callback: () => unknown, delay?: number) => {
    const timer = allocateTimer(() => {}, delay);
    queue.push({ callback, delay, timer });
    return timer;
  });
  const manager = new ModelSyncManager({ prepare() { throw new Error('Unexpected database query'); } });
  const syncMock = t.mock.method(manager, 'syncProvider', sync);
  try { await run(manager, queue, output, raw); }
  finally {
    manager.stopAllAutoSync();
    syncMock.mock.restore();
    scheduler.mock.restore();
    t.mock.timers.reset();
    loggerMock.mock.restore();
    consoleMock.mock.restore();
    destination.destroy();
  }
}

async function step(queue: Scheduled[], delay: number) {
  const scheduled = queue.shift();
  assert.ok(scheduled);
  assert.equal(scheduled.delay, delay);
  clearTimeout(scheduled.timer);
  // Await the actual async scheduler callback so even a hostile instanceof
  // rejection is an assertion failure, never an unhandled background promise.
  await assert.doesNotReject(async () => { await scheduled.callback(); });
}

function failedEvent(output: string[], raw: string[]) {
  assert.equal(raw.join('').includes(CANARY), false);
  assert.deepEqual(raw, []);
  assert.equal(output.length, 1);
  assert.equal(output.join('').includes(CANARY), false);
  const entry: Record<string, unknown> = JSON.parse(output[0]!);
  const { pid, hostname, time, ...event } = entry;
  assert.equal(typeof pid, 'number');
  assert.equal(typeof hostname, 'string');
  assert.equal(typeof time, 'number');
  // This fixed message is the approved decision of this delivery, not a
  // claim that a pre-existing protocol contract already prescribed it.
  assert.deepEqual(event, {
    level: 50, msg: 'Model auto-sync failed.', outcome: 'failed', code: 'INTERNAL_ERROR',
  });
}

describe('LOG-OPERATIONS model auto-sync failures', { concurrency: false }, () => {
  const failures = [
    ['error', () => new Error(CANARY)],
    ['string', () => CANARY],
    ['message getter', () => ({ get message() { throw new Error(CANARY); } })],
    ['coercion', () => ({ toString() { throw new Error(CANARY); } })],
    ['prototype trap', () => new Proxy({}, { getPrototypeOf() { throw new Error(CANARY); } })],
    ['revoked proxy', () => {
      const proxy = Proxy.revocable({}, {});
      proxy.revoke();
      return proxy.proxy;
    }],
    ['impostor', () => Object.create(ModelSyncAlreadyRunningError.prototype)],
  ] as const;

  for (const [label, create] of failures) {
    it('contains ' + label + ' and schedules the next attempt', async (t) => {
      const value: unknown = create();
      let calls = 0;
      await fixture(t, async () => { calls++; throw value; }, async (manager, queue, output, raw) => {
        manager.startAutoSync(CONFIG);
        await step(queue, 0);
        assert.equal(calls, 1);
        assert.equal(queue.length, 1);
        assert.equal(queue[0]?.delay, CONFIG.autoSyncIntervalMs);
        failedEvent(output, raw);
        output.length = 0;
        await step(queue, CONFIG.autoSyncIntervalMs);
        assert.equal(calls, 2);
        failedEvent(output, raw);
      });
    });
  }

  it('silently preserves genuine overlap suppression and rescheduling', async (t) => {
    const conflict = new ModelSyncAlreadyRunningError({
      provider: 'openai', isRunning: true, startedAt: 1, lastCompletedAt: null,
      lastSuccessAt: null, lastError: CANARY, lastResultSummary: null,
    });
    await fixture(t, async () => { throw conflict; }, async (manager, queue, output, raw) => {
      manager.startAutoSync(CONFIG);
      await step(queue, 0);
      assert.equal(queue.length, 1);
      assert.equal(queue[0]?.delay, CONFIG.autoSyncIntervalMs);
      assert.deepEqual(output, []);
      assert.deepEqual(raw, []);
    });
  });

  it('keeps successful work silent and does not reschedule after stopping in flight', async (t) => {
    let release: ((result: ModelSyncResult) => void) | undefined;
    const pending = new Promise<ModelSyncResult>((resolve) => { release = resolve; });
    await fixture(t, () => pending, async (manager, queue, output, raw) => {
      manager.startAutoSync(CONFIG);
      const completion = step(queue, 0);
      manager.stopAllAutoSync();
      assert.ok(release);
      release(SUCCESS);
      await completion;
      assert.deepEqual(queue, []);
      assert.deepEqual(output, []);
      assert.deepEqual(raw, []);
    });
  });
});
