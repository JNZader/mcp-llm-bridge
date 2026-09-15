import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { describe, it, type TestContext } from 'node:test';
import { createLogger, logger } from '../../src/core/logger.js';
import { PriceManager, PriceSyncAlreadyRunningError } from '../../src/price-sync/price-manager.js';
import type { PriceSyncResult } from '../../src/price-sync/types.js';

const CANARY = 'private-price-sync-log-canary';
const INTERVAL = 5000;
const SUCCESS: PriceSyncResult = {
  timestamp: 123, updated: 1, added: 2, unchanged: 3,
};

interface Scheduled {
  callback: () => unknown;
  delay: number | undefined;
  timer: ReturnType<typeof setTimeout>;
}

async function fixture(
  t: TestContext,
  sync: () => Promise<PriceSyncResult>,
  run: (manager: PriceManager, queue: Scheduled[], output: string[], raw: string[]) => Promise<void>,
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
  let preparations = 0;
  // PriceManager loads its cache in the constructor. Supply only that inert
  // query result; no database exists and any later query is a fixture failure.
  const manager = new PriceManager({ prepare(sql) {
    assert.equal(++preparations, 1);
    assert.equal(sql.replace(/\s+/g, ' ').trim(),
      'SELECT provider, model_id, model_name, input_price, output_price, cache_read_price, cache_write_price, currency FROM model_pricing');
    return {
      all() { return []; },
      get() { throw new Error('Unexpected database get'); },
      run() { throw new Error('Unexpected database write'); },
    };
  } }, { autoSyncIntervalMs: INTERVAL });
  const syncMock = t.mock.method(manager, 'syncFromUpstream', sync);
  try { await run(manager, queue, output, raw); }
  finally {
    manager.stopAutoSync();
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
    level: 50, msg: 'Price auto-sync failed.', outcome: 'failed', code: 'INTERNAL_ERROR',
  });
}

describe('LOG-OPERATIONS price auto-sync failures', { concurrency: false }, () => {
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
    ['impostor', () => Object.create(PriceSyncAlreadyRunningError.prototype)],
  ] as const;

  for (const [label, create] of failures) {
    it('contains ' + label + ' and schedules the next attempt', async (t) => {
      const value: unknown = create();
      let calls = 0;
      await fixture(t, async () => { calls++; throw value; }, async (manager, queue, output, raw) => {
        manager.startAutoSync(INTERVAL);
        await step(queue, 0);
        assert.equal(calls, 1);
        assert.equal(queue.length, 1);
        assert.equal(queue[0]?.delay, INTERVAL);
        failedEvent(output, raw);
        output.length = 0;
        await step(queue, INTERVAL);
        assert.equal(calls, 2);
        failedEvent(output, raw);
      });
    });
  }

  it('silently preserves genuine overlap suppression and rescheduling', async (t) => {
    const conflict = new PriceSyncAlreadyRunningError({
      isRunning: true, startedAt: 1, lastCompletedAt: null,
      lastSuccessAt: null, lastError: CANARY, lastResultSummary: null,
    });
    await fixture(t, async () => { throw conflict; }, async (manager, queue, output, raw) => {
      manager.startAutoSync(INTERVAL);
      await step(queue, 0);
      assert.equal(queue.length, 1);
      assert.equal(queue[0]?.delay, INTERVAL);
      assert.deepEqual(output, []);
      assert.deepEqual(raw, []);
    });
  });

  it('keeps successful work silent and does not reschedule after stopping in flight', async (t) => {
    let release: ((result: PriceSyncResult) => void) | undefined;
    const pending = new Promise<PriceSyncResult>((resolve) => { release = resolve; });
    await fixture(t, () => pending, async (manager, queue, output, raw) => {
      manager.startAutoSync(INTERVAL);
      const completion = step(queue, 0);
      manager.stopAutoSync();
      assert.ok(release);
      release(SUCCESS);
      await completion;
      assert.deepEqual(queue, []);
      assert.deepEqual(output, []);
      assert.deepEqual(raw, []);
    });
  });
});
