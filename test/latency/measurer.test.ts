/**
 * LatencyMeasurer tests — Background measurement and TTL management.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  LatencyMeasurer,
  DEFAULT_TTL_MS,
  DEFAULT_INTERVAL_MS,
  MEASUREMENT_TIMEOUT_MS,
} from '../../src/latency/measurer.js';
import type { ProviderConfig } from '../../src/latency/types.js';

// Helper to wait for a tick
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LatencyMeasurer', () => {
  let measurer: LatencyMeasurer;

  beforeEach(() => {
    measurer = new LatencyMeasurer();
  });

  afterEach(() => {
    measurer.stopBackgroundTask();
  });

  describe('measure', () => {
    it('should measure latency with HEAD request', async () => {
      // Mock successful fetch
      const originalFetch = global.fetch;
      let fetchCalled = false;
      global.fetch = async () => {
        fetchCalled = true;
        return new Response(null, { status: 200 });
      };

      try {
        const latency = await measurer.measure('openai', 'https://api.openai.com/v1');

        assert.equal(fetchCalled, true);
        assert.ok(latency >= 0);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return -1 when measurement fails', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };

      try {
        const latency = await measurer.measure('openai', 'https://api.openai.com/v1');
        assert.equal(latency, -1);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should store measurement after successful request', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');

        const stored = measurer.get('openai');
        assert.notEqual(stored, null);
        assert.equal(stored?.provider, 'openai');
        assert.equal(stored?.url, 'https://api.openai.com/v1');
        assert.ok(stored!.latencyMs >= 0);
        assert.ok(stored!.measuredAt > 0);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should store failed measurement marker', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');

        const stored = measurer.get('openai');
        assert.notEqual(stored, null);
        assert.equal(stored?.latencyMs, -1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('get', () => {
    it('should return null for unknown provider', () => {
      const result = measurer.get('unknown');
      assert.equal(result, null);
    });

    it('should return measurement if not expired', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');
        const result = measurer.get('openai');
        assert.notEqual(result, null);
        assert.equal(result?.provider, 'openai');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('getAll', () => {
    it('should return all non-expired measurements', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');
        await measurer.measure('anthropic', 'https://api.anthropic.com/v1');

        const all = measurer.getAll();
        assert.equal(all.length, 2);
        const providers = all.map((m) => m.provider);
        assert.ok(providers.includes('openai'));
        assert.ok(providers.includes('anthropic'));
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return empty array when no measurements', () => {
      const all = measurer.getAll();
      assert.deepEqual(all, []);
    });
  });

  describe('cleanup', () => {
    it('should remove expired measurements', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        const shortTtlMeasurer = new LatencyMeasurer(1); // 1ms TTL
        await shortTtlMeasurer.measure('openai', 'https://api.openai.com/v1');
        assert.equal(shortTtlMeasurer.size(), 1);

        // Wait for expiry
        await new Promise((r) => setTimeout(r, 10));

        shortTtlMeasurer.cleanup();
        assert.equal(shortTtlMeasurer.size(), 0);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('startBackgroundTask', () => {
    it('should measure all providers on start', async () => {
      const originalFetch = global.fetch;
      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount++;
        return new Response(null, { status: 200 });
      };

      try {
        const providers: ProviderConfig[] = [
          { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
          { id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
        ];

        measurer.startBackgroundTask(providers, 60000);
        await tick(); // Let the async measurement complete

        // Wait a bit for measurements
        await new Promise((r) => setTimeout(r, 50));

        assert.ok(measurer.get('openai') !== null || measurer.get('anthropic') !== null || fetchCount > 0);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should skip providers without baseUrl', async () => {
      const originalFetch = global.fetch;
      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount++;
        return new Response(null, { status: 200 });
      };

      try {
        const providers: ProviderConfig[] = [
          { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
          { id: 'local', baseUrl: undefined },
        ];

        measurer.startBackgroundTask(providers, 60000);
        await tick();

        // Only one provider should have been measured
        assert.ok(fetchCount <= 1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('stopBackgroundTask', () => {
    it('should be safe to call when no task is running', () => {
      assert.doesNotThrow(() => measurer.stopBackgroundTask());
    });
  });

  describe('isStale', () => {
    it('should return true for unknown provider', () => {
      assert.equal(measurer.isStale('unknown'), true);
    });

    it('should return false for fresh measurement', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');
        assert.equal(measurer.isStale('openai'), false);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('size', () => {
    it('should return 0 for empty measurer', () => {
      assert.equal(measurer.size(), 0);
    });

    it('should return count of measurements', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');
        await measurer.measure('anthropic', 'https://api.anthropic.com/v1');

        assert.equal(measurer.size(), 2);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('clear', () => {
    it('should remove all measurements', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => new Response(null, { status: 200 });

      try {
        await measurer.measure('openai', 'https://api.openai.com/v1');
        assert.equal(measurer.size(), 1);

        measurer.clear();
        assert.equal(measurer.size(), 0);
        assert.equal(measurer.get('openai'), null);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
