/**
 * Local LLM client tests — error handling and URL construction.
 *
 * Network calls are NOT tested here (no mocking fetch in node:test).
 * We test the error class and exported contract.
 */

import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { LocalLLMError, callLocalLLM, pingBackend } from '../../src/local-llm/client.js';
import {
  createFakeTimeoutHandle,
  createMockClearTimeout,
  createMockSetTimeout,
} from '../helpers/timeout-mocks.js';

const TEST_MODEL = {
  id: 'llama3.2:3b',
  name: 'llama3.2:3b',
  backend: 'ollama' as const,
  loaded: true,
};

afterEach(() => {
  mock.restoreAll();
});

// ── LocalLLMError ──────────────────────────────────────────

describe('LocalLLMError', () => {
  it('has correct name', () => {
    const err = new LocalLLMError('test', 'ollama');
    assert.equal(err.name, 'LocalLLMError');
  });

  it('stores backend type', () => {
    const err = new LocalLLMError('test', 'lm-studio');
    assert.equal(err.backend, 'lm-studio');
  });

  it('stores cause when provided', () => {
    const cause = new Error('network');
    const err = new LocalLLMError('test', 'ollama', cause);
    assert.equal(err.cause, cause);
  });

  it('is an instanceof Error', () => {
    const err = new LocalLLMError('test', 'ollama');
    assert.ok(err instanceof Error);
  });

  it('preserves message', () => {
    const err = new LocalLLMError('Connection refused', 'ollama');
    assert.equal(err.message, 'Connection refused');
  });
});

describe('callLocalLLM timer cleanup', () => {
  it('redacts quoted JSON and bearer secrets from backend errors', async () => {
    const quotedSecret = 'super-secret';
    const bearerSecret = 'another-secret';
    mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 502,
      text: async () => `{"api_key":"${quotedSecret}","token":"${bearerSecret}"} authorization=auth-secret Bearer ${bearerSecret}`,
    }) as Response);

    await assert.rejects(
      () => callLocalLLM(TEST_MODEL, 'hello'),
      (error: unknown) => {
        assert.ok(error instanceof LocalLLMError);
        assert.doesNotMatch(error.message, new RegExp(`${quotedSecret}|${bearerSecret}`));
        assert.doesNotMatch(error.message, /auth-secret/);
        assert.match(error.message, /api_key.*REDACTED/);
        assert.match(error.message, /authorization.*REDACTED/);
        assert.match(error.message, /Bearer \[REDACTED\]/);
        return true;
      },
    );
  });

  it('clears the abort timer when fetch fails before timeout', async () => {
    const timerToken = createFakeTimeoutHandle('request-timer');
    const setTimeoutMock = createMockSetTimeout(() => timerToken);
    const clearTimeoutMock = createMockClearTimeout();
    const fetchMock = mock.fn(async () => {
      throw new Error('socket hang up');
    });

    mock.method(globalThis, 'setTimeout', setTimeoutMock);
    mock.method(globalThis, 'clearTimeout', clearTimeoutMock);
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    await assert.rejects(
      () => callLocalLLM(TEST_MODEL, 'hello'),
      (error: unknown) => {
        assert.ok(error instanceof LocalLLMError);
        assert.equal(error.message, 'Request failed: socket hang up');
        return true;
      },
    );

    assert.equal(setTimeoutMock.mock.callCount(), 1);
    assert.equal(clearTimeoutMock.mock.callCount(), 1);
    assert.equal(clearTimeoutMock.mock.calls[0]?.arguments[0], timerToken);
  });

  it('preserves timeout errors while still clearing the abort timer', async () => {
    const timerToken = createFakeTimeoutHandle('request-timeout-timer');
    const setTimeoutMock = createMockSetTimeout(() => timerToken);
    const clearTimeoutMock = createMockClearTimeout();
    const fetchMock = mock.fn(async () => {
      throw new Error('operation aborted');
    });

    mock.method(globalThis, 'setTimeout', setTimeoutMock);
    mock.method(globalThis, 'clearTimeout', clearTimeoutMock);
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    await assert.rejects(
      () => callLocalLLM(TEST_MODEL, 'hello'),
      (error: unknown) => {
        assert.ok(error instanceof LocalLLMError);
        assert.equal(error.message, 'Request timed out');
        return true;
      },
    );

    assert.equal(clearTimeoutMock.mock.callCount(), 1);
    assert.equal(clearTimeoutMock.mock.calls[0]?.arguments[0], timerToken);
  });
});

describe('pingBackend timer cleanup', () => {
  it('clears the abort timer when ping fails', async () => {
    const timerToken = createFakeTimeoutHandle('ping-timer');
    const setTimeoutMock = createMockSetTimeout(() => timerToken);
    const clearTimeoutMock = createMockClearTimeout();
    const fetchMock = mock.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    mock.method(globalThis, 'setTimeout', setTimeoutMock);
    mock.method(globalThis, 'clearTimeout', clearTimeoutMock);
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const reachable = await pingBackend('ollama');

    assert.equal(reachable, false);
    assert.equal(clearTimeoutMock.mock.callCount(), 1);
    assert.equal(clearTimeoutMock.mock.calls[0]?.arguments[0], timerToken);
  });
});
