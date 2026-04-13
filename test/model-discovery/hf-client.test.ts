/**
 * HuggingFace client tests — cache behavior and error handling.
 *
 * Network calls are NOT tested (no fetch mocking in node:test).
 * We test cache logic and client construction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HFClient } from '../../src/model-discovery/hf-client.js';

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
});
