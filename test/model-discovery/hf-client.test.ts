/**
 * HuggingFace client tests — cache behavior and error handling.
 *
 * Network calls are NOT tested (no fetch mocking in node:test).
 * We test cache logic and client construction.
 */

import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { HFClient } from '../../src/model-discovery/hf-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    json: async () => body,
  } as Response;
}

afterEach(() => {
  mock.restoreAll();
});

describe('HFClient', () => {
  it('creates with default config', () => {
    const client = new HFClient();
    assert.equal(client.cacheSize, 0);
  });

  it('creates with custom config', () => {
    const client = new HFClient({
      hfApiUrl: 'https://custom.api.com',
      hfTimeoutMs: 10000,
    });
    assert.equal(client.cacheSize, 0);
  });

  it('clearCache empties the cache', () => {
    const client = new HFClient();
    // Trigger a cache miss (fetch will fail without network)
    // Just verify clearCache doesn't throw
    client.clearCache();
    assert.equal(client.cacheSize, 0);
  });

  it('cacheSize reports correct count after clear', () => {
    const client = new HFClient();
    client.clearCache();
    assert.equal(client.cacheSize, 0);
  });

  it('clears the abort timer after a successful metadata fetch', async () => {
    const timerToken = { id: 'hf-success-timer' };
    const setTimeoutMock = mock.fn(() => timerToken as ReturnType<typeof setTimeout>);
    const clearTimeoutMock = mock.fn();
    const fetchMock = mock.fn(async () => jsonResponse({
      id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      author: 'Qwen',
      downloads: 42,
      tags: ['text-generation'],
      pipeline_tag: 'text-generation',
    }));

    mock.method(globalThis, 'setTimeout', setTimeoutMock as typeof setTimeout);
    mock.method(globalThis, 'clearTimeout', clearTimeoutMock as typeof clearTimeout);
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const client = new HFClient();
    const result = await client.fetchMetadataWithStatus('Qwen/Qwen2.5-Coder-7B-Instruct');

    assert.equal(result.error, null);
    assert.equal(result.stale, false);
    assert.equal(result.metadata?.hfModelId, 'Qwen/Qwen2.5-Coder-7B-Instruct');
    assert.equal(clearTimeoutMock.mock.callCount(), 1);
    assert.equal(clearTimeoutMock.mock.calls[0]?.arguments[0], timerToken);
  });

  it('clears the abort timer when HF returns a non-OK response', async () => {
    const timerToken = { id: 'hf-error-timer' };
    const setTimeoutMock = mock.fn(() => timerToken as ReturnType<typeof setTimeout>);
    const clearTimeoutMock = mock.fn();
    const fetchMock = mock.fn(async () => jsonResponse({ error: 'nope' }, 503));

    mock.method(globalThis, 'setTimeout', setTimeoutMock as typeof setTimeout);
    mock.method(globalThis, 'clearTimeout', clearTimeoutMock as typeof clearTimeout);
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const client = new HFClient();
    const result = await client.fetchMetadataWithStatus('broken/model');

    assert.equal(result.metadata, null);
    assert.equal(result.stale, false);
    assert.equal(result.error, 'HF metadata lookup failed for broken/model: HTTP 503: ERROR');
    assert.equal(clearTimeoutMock.mock.callCount(), 1);
    assert.equal(clearTimeoutMock.mock.calls[0]?.arguments[0], timerToken);
  });
});
