/**
 * TDD Tests for Price Manager
 *
 * Feature 9: Price Sync
 * Following Red → Green → Refactor cycle
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PriceManager,
  createPriceManager,
  PriceFetcher,
  type Database,
} from '../../src/price-sync/index.js';

// === Mock Database ===

function createMockDatabase(): Database {
  const tables = {
    model_pricing: new Map<string, Record<string, unknown>>(),
    price_sync_log: new Map<number, Record<string, unknown>>(),
  };

  let pricingId = 1;
  let syncLogId = 1;

  return {
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          if (sql.includes('INSERT INTO model_pricing')) {
            const key = `${params[0]}:${params[1]}`;
            tables.model_pricing.set(key, {
              id: pricingId++,
              provider: params[0],
              model_id: params[1],
              model_name: params[2],
              input_price: params[3],
              output_price: params[4],
              cache_read_price: params[5],
              cache_write_price: params[6],
              currency: params[7],
              source: params[8],
              updated_at: params[9],
              is_overridden: params[10],
            });
            return { lastInsertRowid: pricingId - 1 };
          }

          if (sql.includes('UPDATE model_pricing')) {
            // Parse the WHERE clause to get provider and model_id
            const provider = params[params.length - 2] as string;
            const modelId = params[params.length - 1] as string;
            const key = `${provider}:${modelId}`;
            const existing = tables.model_pricing.get(key);
            if (existing) {
              // Handle clearPriceOverride pattern: "SET is_overridden = 0, source = 'models.dev'"
              if (sql.includes('is_overridden = 0')) {
                existing.is_overridden = 0;
              }
              if (sql.includes("source = 'models.dev'")) {
                existing.source = 'models.dev';
              }
              
              // Handle parameterized updates (setPriceOverride/updatePrice patterns)
              let paramIndex = 0;
              
              if (sql.includes('model_name = ?')) {
                existing.model_name = params[paramIndex++];
              }
              if (sql.includes('input_price = ?')) {
                existing.input_price = params[paramIndex++];
              }
              if (sql.includes('output_price = ?')) {
                existing.output_price = params[paramIndex++];
              }
              if (sql.includes('cache_read_price = ?')) {
                existing.cache_read_price = params[paramIndex++];
              }
              if (sql.includes('cache_write_price = ?')) {
                existing.cache_write_price = params[paramIndex++];
              }
              if (sql.includes('currency = ?')) {
                existing.currency = params[paramIndex++];
              }
              if (sql.includes('source = ?')) {
                existing.source = params[paramIndex++];
              }
              if (sql.includes('updated_at = ?')) {
                existing.updated_at = params[paramIndex++];
              }
              if (sql.includes('is_overridden = ?')) {
                existing.is_overridden = params[paramIndex++];
              }
            }
            return { lastInsertRowid: 0 };
          }

          if (sql.includes('INSERT INTO price_sync_log')) {
            tables.price_sync_log.set(syncLogId++, {
              id: syncLogId - 1,
              synced_at: params[0],
              models_updated: params[1],
              models_added: params[2],
              error: params[3],
            });
            return { lastInsertRowid: syncLogId - 1 };
          }

          return { lastInsertRowid: 0 };
        },

        all(...params: unknown[]) {
          if (sql.includes('FROM model_pricing')) {
            const result = Array.from(tables.model_pricing.values());

            if (sql.includes('WHERE is_overridden = 1')) {
              return result.filter((row) => row.is_overridden === 1);
            }

            return result.map((row) => ({
              provider: row.provider,
              model_id: row.model_id,
              model_name: row.model_name,
              input_price: row.input_price,
              output_price: row.output_price,
              cache_read_price: row.cache_read_price,
              cache_write_price: row.cache_write_price,
              currency: row.currency,
            }));
          }

          if (sql.includes('FROM price_sync_log')) {
            const limit = (params[0] as number) ?? 100;
            return Array.from(tables.price_sync_log.values())
              .reverse()
              .slice(0, limit)
              .map((row) => ({
                id: row.id,
                synced_at: row.synced_at,
                models_updated: row.models_updated,
                models_added: row.models_added,
                error: row.error,
              }));
          }

          return [];
        },

        get(...params: unknown[]) {
          if (sql.includes('FROM model_pricing')) {
            const key = `${params[0]}:${params[1]}`;
            const row = tables.model_pricing.get(key);
            if (!row) return undefined;

            return {
              id: row.id,
              provider: row.provider,
              model_id: row.model_id,
              model_name: row.model_name,
              input_price: row.input_price,
              output_price: row.output_price,
              cache_read_price: row.cache_read_price,
              cache_write_price: row.cache_write_price,
              currency: row.currency,
              source: row.source,
              updated_at: row.updated_at,
              is_overridden: row.is_overridden,
            };
          }
          return undefined;
        },
      };
    },
  };
}

// === Mock Fetch ===

function mockFetch(response: unknown): typeof fetch {
  return () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(response),
  } as Response);
}

function mockFetchError(status: number): typeof fetch {
  return () => Promise.resolve({
    ok: false,
    status,
  } as Response);
}

// === Tests ===

describe('PriceManager', () => {
  let db: Database;
  let manager: PriceManager;

  beforeEach(() => {
    db = createMockDatabase();
    manager = createPriceManager(db);
  });

  describe('syncFromUpstream', () => {
    it('should fetch and store prices from models.dev', async () => {
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              name: 'GPT-4o',
              input: { price: 2.5, currency: 'USD' },
              output: { price: 10.0, currency: 'USD' },
            },
          },
        },
      });

      const result = await manager.syncFromUpstream();

      assert.strictEqual(result.added, 1);
      assert.strictEqual(result.updated, 0);
      assert.strictEqual(result.unchanged, 0);
    });

    it('should handle fetch errors', async () => {
      global.fetch = mockFetchError(500);

      await assert.rejects(
        async () => manager.syncFromUpstream(),
        /Failed to fetch prices/
      );
    });

    it('should update existing non-overridden prices', async () => {
      // First sync - add initial price
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              name: 'GPT-4o',
              input: { price: 2.5, currency: 'USD' },
              output: { price: 10.0, currency: 'USD' },
            },
          },
        },
      });

      await manager.syncFromUpstream();

      // Second sync with updated price
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              name: 'GPT-4o',
              input: { price: 3.0, currency: 'USD' },
              output: { price: 12.0, currency: 'USD' },
            },
          },
        },
      });

      const result = await manager.syncFromUpstream();

      assert.strictEqual(result.updated, 1);
      assert.strictEqual(result.added, 0);
    });

    it('should not update overridden prices on sync', async () => {
      // First sync - add initial price
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              name: 'GPT-4o',
              input: { price: 2.5, currency: 'USD' },
              output: { price: 10.0, currency: 'USD' },
            },
          },
        },
      });

      await manager.syncFromUpstream();

      // Set manual override with ridiculous price
      manager.setPriceOverride('openai', 'gpt-4o', {
        inputPrice: 999.0,
        outputPrice: 999.0,
      });

      // Second sync with different prices
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              name: 'GPT-4o',
              input: { price: 3.0, currency: 'USD' },
              output: { price: 12.0, currency: 'USD' },
            },
          },
        },
      });

      const result = await manager.syncFromUpstream();

      // Should not update the overridden price
      assert.strictEqual(result.updated, 0);
      assert.strictEqual(result.unchanged, 1);

      const price = manager.getPrice('openai', 'gpt-4o');
      assert.strictEqual(price?.inputPrice, 999.0);
      assert.strictEqual(price?.outputPrice, 999.0);
    });

    it('should log sync history', async () => {
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              name: 'GPT-4o',
              input: { price: 2.5, currency: 'USD' },
              output: { price: 10.0, currency: 'USD' },
            },
          },
        },
      });

      await manager.syncFromUpstream();

      const history = manager.getSyncHistory(10);
      assert.ok(history.length > 0);
      assert.strictEqual(history[0]!.modelsAdded, 1);
      assert.strictEqual(history[0]!.modelsUpdated, 0);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly', () => {
      // Store a price first
      manager.setPriceOverride('openai', 'gpt-4o', {
        inputPrice: 2.5,
        outputPrice: 10.0,
        currency: 'USD',
      });

      const cost = manager.calculateCost('openai', 'gpt-4o', 1000, 500);

      // (1000/1M) * $2.50 = $0.0025 input
      // (500/1M) * $10.00 = $0.005 output
      // Total: $0.0075
      assert.strictEqual(cost.inputCost, 0.0025);
      assert.strictEqual(cost.outputCost, 0.005);
      assert.strictEqual(cost.totalCost, 0.0075);
      assert.strictEqual(cost.currency, 'USD');
    });

    it('should support Anthropic cache pricing', () => {
      manager.setPriceOverride('anthropic', 'claude-3-sonnet', {
        inputPrice: 3.0,
        outputPrice: 15.0,
        cacheReadPrice: 1.5,
        cacheWritePrice: 3.75,
        currency: 'USD',
      });

      const cost = manager.calculateCost(
        'anthropic',
        'claude-3-sonnet',
        1000,
        500,
        { read: 800, write: 200 }
      );

      assert.strictEqual(cost.cacheReadCost, (800 / 1_000_000) * 1.5);
      assert.strictEqual(cost.cacheWriteCost, (200 / 1_000_000) * 3.75);
      assert.ok(cost.totalCost > cost.inputCost + cost.outputCost);

      // Verify breakdown
      const expectedInputCost = (1000 / 1_000_000) * 3.0;
      const expectedOutputCost = (500 / 1_000_000) * 15.0;
      const expectedCacheReadCost = (800 / 1_000_000) * 1.5;
      const expectedCacheWriteCost = (200 / 1_000_000) * 3.75;
      const expectedTotal =
        expectedInputCost +
        expectedOutputCost +
        expectedCacheReadCost +
        expectedCacheWriteCost;

      assert.strictEqual(cost.inputCost, expectedInputCost);
      assert.strictEqual(cost.outputCost, expectedOutputCost);
      assert.strictEqual(cost.cacheReadCost, expectedCacheReadCost);
      assert.strictEqual(cost.cacheWriteCost, expectedCacheWriteCost);
      assert.strictEqual(cost.totalCost, expectedTotal);
    });

    it('should return zero cost for unknown model', () => {
      const cost = manager.calculateCost('unknown', 'unknown-model', 1000, 500);

      assert.strictEqual(cost.inputCost, 0);
      assert.strictEqual(cost.outputCost, 0);
      assert.strictEqual(cost.totalCost, 0);
      assert.strictEqual(cost.currency, 'USD');
    });

    it('should handle missing cache pricing gracefully', () => {
      manager.setPriceOverride('openai', 'gpt-4o', {
        inputPrice: 2.5,
        outputPrice: 10.0,
        currency: 'USD',
        // No cache pricing
      });

      const cost = manager.calculateCost(
        'openai',
        'gpt-4o',
        1000,
        500,
        { read: 800, write: 200 }
      );

      // Should not have cache costs since no cache pricing defined
      assert.strictEqual(cost.cacheReadCost, undefined);
      assert.strictEqual(cost.cacheWriteCost, undefined);
      assert.strictEqual(cost.totalCost, cost.inputCost + cost.outputCost);
    });
  });

  describe('setPriceOverride', () => {
    it('should create new price entry if not exists', () => {
      manager.setPriceOverride('custom', 'custom-model', {
        inputPrice: 5.0,
        outputPrice: 10.0,
        currency: 'USD',
      });

      const price = manager.getPrice('custom', 'custom-model');
      assert.notStrictEqual(price, null);
      assert.strictEqual(price?.inputPrice, 5.0);
      assert.strictEqual(price?.outputPrice, 10.0);
    });

    it('should update existing price and mark as overridden', () => {
      // First add a price
      manager.setPriceOverride('openai', 'gpt-4o', {
        inputPrice: 2.5,
        outputPrice: 10.0,
      });

      // Override it
      manager.setPriceOverride('openai', 'gpt-4o', {
        inputPrice: 999.0,
      });

      const price = manager.getPrice('openai', 'gpt-4o');
      assert.strictEqual(price?.inputPrice, 999.0);
      assert.strictEqual(price?.outputPrice, 10.0); // Should keep old output price
    });
  });

  describe('clearPriceOverride', () => {
    it('should remove override flag from price', async () => {
      // Set override first
      manager.setPriceOverride('openai', 'gpt-4o', {
        inputPrice: 999.0,
      });

      // Clear it
      manager.clearPriceOverride('openai', 'gpt-4o');

      // After clearing, sync should update the price
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              input: { price: 2.5, currency: 'USD' },
              output: { price: 10.0, currency: 'USD' },
            },
          },
        },
      });

      // This should now update the price since override was cleared
      manager = createPriceManager(db); // Create fresh manager to reload cache
      const result = await manager.syncFromUpstream();
      assert.strictEqual(result.updated, 1); // Price was cleared and now updated

      const price = manager.getPrice('openai', 'gpt-4o');
      assert.strictEqual(price?.inputPrice, 2.5);
    });
  });

  describe('auto-sync', () => {
    it('should start auto-sync', () => {
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': {
              input: { price: 2.5, currency: 'USD' },
            },
          },
        },
      });

      manager.startAutoSync(1000);

      assert.strictEqual(manager.isAutoSyncRunning(), true);

      manager.stopAutoSync();
    });

    it('should stop auto-sync', () => {
      manager.startAutoSync(1000);
      assert.strictEqual(manager.isAutoSyncRunning(), true);

      manager.stopAutoSync();
      assert.strictEqual(manager.isAutoSyncRunning(), false);
    });

    it('should auto-sync periodically', () => {
      return new Promise<void>((resolve) => {
        let syncCount = 0;
        manager.syncFromUpstream = async () => {
          syncCount++;
          return { updated: 0, added: 0, unchanged: 0, timestamp: Date.now() };
        };

        manager.startAutoSync(100); // 100ms for testing

        setTimeout(() => {
          assert.ok(syncCount >= 2);
          manager.stopAutoSync();
          resolve();
        }, 250);
      });
    });
  });

  describe('getAllPrices', () => {
    it('should get all prices', () => {
      manager.setPriceOverride('openai', 'gpt-4o', { inputPrice: 2.5 });
      manager.setPriceOverride('anthropic', 'claude-3', { inputPrice: 3.0 });

      const prices = manager.getAllPrices();
      assert.strictEqual(prices.length, 2);
    });

    it('should filter to overrides only', () => {
      // First sync to add non-overridden prices
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': { input: { price: 2.5, currency: 'USD' } },
          },
        },
      });

      manager.syncFromUpstream();

      // Add an override
      manager.setPriceOverride('anthropic', 'claude-3', { inputPrice: 999.0 });

      const prices = manager.getAllPrices({ overridesOnly: true });
      assert.strictEqual(prices.length, 1);
      assert.strictEqual(prices[0]!.provider, 'anthropic');
    });
  });

  describe('getSyncHistory', () => {
    it('should return sync history', async () => {
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': { input: { price: 2.5, currency: 'USD' } },
          },
        },
      });

      await manager.syncFromUpstream();

      const history = manager.getSyncHistory(10);
      assert.ok(history.length > 0);
    });

    it('should respect limit parameter', async () => {
      global.fetch = mockFetch({
        providers: {
          openai: {
            'gpt-4o': { input: { price: 2.5, currency: 'USD' } },
          },
        },
      });

      // Run multiple syncs
      for (let i = 0; i < 5; i++) {
        await manager.syncFromUpstream();
      }

      const history = manager.getSyncHistory(3);
      assert.ok(history.length <= 3);
    });
  });
});

describe('PriceFetcher', () => {
  it('should fetch and parse models.dev response', async () => {
    global.fetch = mockFetch({
      providers: {
        openai: {
          'gpt-4o': {
            name: 'GPT-4o',
            input: { price: 2.5, currency: 'USD' },
            output: { price: 10.0, currency: 'USD' },
          },
          'gpt-3.5-turbo': {
            name: 'GPT-3.5 Turbo',
            input: { price: 0.5, currency: 'USD' },
            output: { price: 1.5, currency: 'USD' },
          },
        },
        anthropic: {
          'claude-3-opus': {
            name: 'Claude 3 Opus',
            input: { price: 15.0, currency: 'USD' },
            output: { price: 75.0, currency: 'USD' },
            cache: { read: 1.5, write: 3.75 },
          },
        },
      },
    });

    const fetcher = new PriceFetcher();
    const prices = await fetcher.fetchPrices();

    assert.strictEqual(prices.length, 3);

    const gpt4o = prices.find((p) => p.modelId === 'gpt-4o');
    assert.ok(gpt4o !== undefined);
    assert.strictEqual(gpt4o?.provider, 'openai');
    assert.strictEqual(gpt4o?.inputPrice, 2.5);
    assert.strictEqual(gpt4o?.outputPrice, 10.0);

    const opus = prices.find((p) => p.modelId === 'claude-3-opus');
    assert.ok(opus !== undefined);
    assert.strictEqual(opus?.provider, 'anthropic');
    assert.strictEqual(opus?.cacheReadPrice, 1.5);
    assert.strictEqual(opus?.cacheWritePrice, 3.75);
  });

  it('should normalize provider names', async () => {
    global.fetch = mockFetch({
      providers: {
        GOOGLE: {
          'gemini-1.5-pro': {
            name: 'Gemini 1.5 Pro',
            input: { price: 3.5, currency: 'USD' },
          },
        },
        DeepSeek: {
          'deepseek-chat': {
            name: 'DeepSeek Chat',
            input: { price: 0.5, currency: 'USD' },
          },
        },
      },
    });

    const fetcher = new PriceFetcher();
    const prices = await fetcher.fetchPrices();

    assert.strictEqual(prices.length, 2);

    const gemini = prices.find((p) => p.provider === 'gemini');
    assert.ok(gemini !== undefined);

    const deepseek = prices.find((p) => p.provider === 'deepseek');
    assert.ok(deepseek !== undefined);
  });

  it('should handle fetch errors', async () => {
    global.fetch = mockFetchError(500);

    const fetcher = new PriceFetcher();
    await assert.rejects(
      async () => fetcher.fetchPrices(),
      /Failed to fetch prices/
    );
  });

  it('should handle missing pricing fields', async () => {
    global.fetch = mockFetch({
      providers: {
        openai: {
          'unknown-model': {
            name: 'Unknown Model',
            // No pricing info
          },
        },
      },
    });

    const fetcher = new PriceFetcher();
    const prices = await fetcher.fetchPrices();

    assert.strictEqual(prices.length, 1);
    assert.strictEqual(prices[0]!.inputPrice, 0);
    assert.strictEqual(prices[0]!.outputPrice, 0);
  });
});
