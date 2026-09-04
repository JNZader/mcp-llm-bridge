import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { executeGenerateRequest } from '../../src/server/execution/generate-service.js';
import { createStreamExecutor } from '../../src/server/streaming/stream-executor.js';
import { createStreamingRequestLogFinalizer } from '../../src/server/streaming/stream-finalizer.js';

const CANARY = 'prompt-response-credential-canary';
const safeMessage = 'An unexpected internal error occurred.';

function logger() {
  const entries: Array<Record<string, unknown>> = [];
  return {
    entries,
    captureStart: () => ({}) as never,
    captureEnd: async (_context: unknown, input: Record<string, unknown> = {}) => {
      entries.push(input);
    },
  };
}

function result() {
  return {
    text: CANARY,
    provider: 'provider-a',
    model: 'model-a',
    resolvedProvider: 'provider-a',
    resolvedModel: 'model-a',
    tokensUsed: 3,
  };
}

const canonical = {
  model: 'model-a',
  messages: [{ role: 'user' as const, content: CANARY }],
  stream: true,
};

async function expectOriginalFailure(run: () => Promise<unknown>, error: Error) {
  await assert.rejects(run, (received: unknown) => received === error);
}

function assertSafeFailure(entry: Record<string, unknown>) {
  const error = entry.error as Error;
  assert.equal(error.message, safeMessage);
  assert.notEqual(error.message, CANARY);
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(CANARY));
}

describe('ERR-EXECUTION', () => {
  it('EXEC-01 non-stream success omits canary-bearing durable response data', async () => {
    const requestLogger = logger();
    const value = await executeGenerateRequest({
      validated: { model: 'model-a', prompt: CANARY } as never,
      scope: {} as never,
      router: { generate: async () => result() } as never,
      requestLogger: requestLogger as never,
    });

    assert.equal(value.text, CANARY);
    assert.equal(requestLogger.entries.length, 1);
    assert.equal(requestLogger.entries[0]?.responseData, undefined);
  });

  it('EXEC-02 non-stream failure persists a safe error but rethrows the original', async () => {
    const requestLogger = logger();
    const original = new Error(CANARY);
    await expectOriginalFailure(
      () => executeGenerateRequest({
        validated: { model: 'model-a', prompt: CANARY } as never,
        scope: {} as never,
        router: { generate: async () => { throw original; } } as never,
        requestLogger: requestLogger as never,
      }),
      original,
    );
    assertSafeFailure(requestLogger.entries[0] ?? {});
  });

  it('EXEC-03 fallback success keeps the client result but omits durable content', async () => {
    const requestLogger = logger();
    const received: string[] = [];
    await createStreamExecutor({
      canonical,
      router: { resolveStreamingProviders: async () => [], generate: async () => result() } as never,
      scope: {} as never,
      requestLogger: requestLogger as never,
    }).execute({
      writeChunk: async () => assert.fail('unexpected chunk'),
      writeFallbackResult: async (value) => { received.push(value.text); },
      writeTerminalError: async () => assert.fail('unexpected error'),
      writeDone: async () => undefined,
    });
    assert.deepEqual(received, [CANARY]);
    assert.equal(requestLogger.entries[0]?.responseData, undefined);
  });

  it('EXEC-04 fallback failure logs safely while retaining the original rejection', async () => {
    const requestLogger = logger();
    const original = new Error(CANARY);
    const executor = createStreamExecutor({
      canonical,
      router: { resolveStreamingProviders: async () => [], generate: async () => { throw original; } } as never,
      scope: {} as never,
      requestLogger: requestLogger as never,
    });
    await expectOriginalFailure(
      () => executor.execute({
        writeChunk: async () => undefined,
        writeFallbackResult: async () => undefined,
        writeTerminalError: async () => undefined,
        writeDone: async () => undefined,
      }),
      original,
    );
    assertSafeFailure(requestLogger.entries[0] ?? {});
  });

  it('EXEC-05 through EXEC-08 sanitize retry, exhaustion, committed-stream, and abort logger errors', async () => {
    const requestLogger = logger();
    const finalizer = createStreamingRequestLogFinalizer(requestLogger as never, 'model-a');
    for (const phase of ['retry', 'exhaustion', 'committed-stream', 'abort']) {
      await finalizer.finalizeRequestLog({ error: new Error(`${CANARY}-${phase}`) });
      assertSafeFailure(requestLogger.entries.at(-1) ?? {});
      const next = createStreamingRequestLogFinalizer(requestLogger as never, 'model-a');
      Object.assign(finalizer, next);
    }
  });
});
