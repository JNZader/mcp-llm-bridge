/**
 * TDD Tests for Model Sync Fetchers
 *
 * Feature 8: Auto Model Sync
 * Following Red → Green → Refactor cycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ModelSyncManager,
  createModelSyncManager,
  PROVIDER_TYPE,
  OpenAIModelFetcher,
  AnthropicModelFetcher,
  GeminiModelFetcher,
  isProviderType,
  isSupportedProvider,
  getFetcherForProvider,
  type Database,
  type ProviderType,
} from '../../src/model-sync/index.js';

// === Mock Database ===

function createMockDatabase(): Database {
  const tables = {
    provider_models: new Map<string, Record<string, unknown>>(),
    model_sync_log: new Map<number, Record<string, unknown>>(),
  };

  let providerModelId = 1;
  let syncLogId = 1;

  return {
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          if (sql.includes('INSERT INTO provider_models')) {
            const key = `${params[0]}:${params[1]}`;
            tables.provider_models.set(key, {
              id: providerModelId++,
              provider: params[0],
              model_id: params[1],
              model_name: params[2],
              model_description: params[3],
              context_length: params[4],
              pricing_input: params[5],
              pricing_output: params[6],
              discovered_at: params[7],
              last_synced_at: params[8],
              is_active: 1,
              match_regex: params[9],
            });
            return { lastInsertRowid: providerModelId - 1 };
          }

          if (sql.includes('UPDATE provider_models')) {
            // Soft delete logic - mark all for provider as inactive
            for (const [_key, row] of tables.provider_models) {
              if (row.provider === params[1]) {
                row.is_active = 0;
                row.last_synced_at = params[0];
              }
            }
            return { lastInsertRowid: 0 };
          }

          if (sql.includes('INSERT INTO model_sync_log')) {
            tables.model_sync_log.set(syncLogId++, {
              id: syncLogId - 1,
              provider: params[0],
              synced_at: params[1],
              models_found: params[2],
              models_added: params[3],
              models_removed: params[4],
              error: params[5],
            });
            return { lastInsertRowid: syncLogId - 1 };
          }

          return { lastInsertRowid: 0 };
        },

        all(...params: unknown[]) {
          if (sql.includes('FROM provider_models')) {
            const provider = params[0] as string;
            const activeOnly = sql.includes('is_active = 1');

            return Array.from(tables.provider_models.values())
              .filter((row) => {
                if (row.provider !== provider) return false;
                if (activeOnly && !row.is_active) return false;
                return true;
              })
              .map((row) => ({
                model_id: row.model_id,
                model_name: row.model_name,
                model_description: row.model_description,
                context_length: row.context_length,
                pricing_input: row.pricing_input,
                pricing_output: row.pricing_output,
              }));
          }

          if (sql.includes('FROM model_sync_log')) {
            const result = Array.from(tables.model_sync_log.values())
              .filter((row) => {
                if (params.length > 0 && params[0] !== undefined) {
                  return row.provider === params[0];
                }
                return true;
              })
              .reverse()
              .slice(0, (params[params.length - 1] as number) ?? 100)
              .map((row) => ({
                id: row.id,
                provider: row.provider,
                synced_at: row.synced_at,
                models_found: row.models_found,
                models_added: row.models_added,
                models_removed: row.models_removed,
                error: row.error,
              }));
            return result;
          }

          return [];
        },

        get(...params: unknown[]) {
          if (sql.includes('FROM provider_models')) {
            const key = `${params[0]}:${params[1]}`;
            return tables.provider_models.get(key) ?? undefined;
          }
          return undefined;
        },
      };
    },
  };
}

// === Mock Fetch ===

function mockFetch(response: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  } as Response);
}

function mockFetchError(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
  } as Response);
}

// === Tests ===

describe('ModelSyncManager', () => {
  let db: Database;
  let manager: ModelSyncManager;

  beforeEach(() => {
    db = createMockDatabase();
    manager = createModelSyncManager(db);
    vi.restoreAllMocks();
  });

  describe('syncProvider', () => {
    it('should fetch models from OpenAI-style provider', async () => {
      global.fetch = mockFetch({
        data: [
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        ],
      });

      const result = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      expect(result.modelsFound.length).toBe(2);
      expect(result.modelsFound.some((m) => m.id === 'gpt-4o')).toBe(true);
      expect(result.provider).toBe(PROVIDER_TYPE.OPENAI);
    });

    it('should filter models by regex', async () => {
      global.fetch = mockFetch({
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4-turbo' },
          { id: 'gpt-3.5-turbo' },
          { id: 'whisper-1' },
        ],
      });

      const result = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        matchRegex: '^gpt-4', // Only GPT-4 models
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      expect(result.modelsFound.length).toBe(2);
      expect(result.modelsFound.every((m) => m.id.startsWith('gpt-4'))).toBe(
        true
      );
    });

    it('should detect added and removed models', async () => {
      // Pre-populate with old model
      const stmt = db.prepare(`INSERT INTO provider_models 
        (provider, model_id, discovered_at, last_synced_at, is_active) 
        VALUES (?, ?, ?, ?, 1)`);
      stmt.run('openai', 'old-model', Date.now(), Date.now());

      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }], // Only new model
      });

      const result = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      expect(result.modelsAdded.length).toBe(1);
      expect(result.modelsAdded[0]!.id).toBe('gpt-4o');
      expect(result.modelsRemoved.length).toBe(1);
      expect(result.modelsRemoved[0]!).toBe('old-model');
    });

    it('should handle fetch errors', async () => {
      global.fetch = mockFetchError(401);

      await expect(
        manager.syncProvider({
          provider: PROVIDER_TYPE.OPENAI,
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'invalid-key',
          autoSyncIntervalMs: 24 * 60 * 60 * 1000,
        })
      ).rejects.toThrow('Failed to fetch models');
    });

    it('should handle invalid regex gracefully', async () => {
      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }],
      });

      const result = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        matchRegex: '[invalid(', // Invalid regex
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      // Should return all models when regex is invalid
      expect(result.modelsFound.length).toBe(2);
    });
  });

  describe('auto-sync', () => {
    it('should start auto-sync for provider', () => {
      global.fetch = mockFetch({ data: [] });

      manager.startAutoSync({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 1000,
      });

      expect(manager.isAutoSyncRunning(PROVIDER_TYPE.OPENAI)).toBe(true);
    });

    it('should stop auto-sync for provider', () => {
      global.fetch = mockFetch({ data: [] });

      manager.startAutoSync({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 1000,
      });

      manager.stopAutoSync(PROVIDER_TYPE.OPENAI);
      expect(manager.isAutoSyncRunning(PROVIDER_TYPE.OPENAI)).toBe(false);
    });

    it('should track running auto-sync providers', () => {
      // Mock both fetch responses since sync happens immediately
      global.fetch = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('anthropic')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        } as Response);
      });

      manager.startAutoSync({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 1000,
      });

      manager.startAutoSync({
        provider: PROVIDER_TYPE.ANTHROPIC,
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 1000,
      });

      const running = manager.getRunningAutoSyncProviders();
      expect(running).toContain(PROVIDER_TYPE.OPENAI);
      expect(running).toContain(PROVIDER_TYPE.ANTHROPIC);
    });

    it('should stop all auto-sync on stopAllAutoSync', () => {
      // Mock both fetch responses since sync happens immediately
      global.fetch = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('anthropic')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        } as Response);
      });

      manager.startAutoSync({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 1000,
      });

      manager.startAutoSync({
        provider: PROVIDER_TYPE.ANTHROPIC,
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 1000,
      });

      manager.stopAllAutoSync();
      expect(manager.getRunningAutoSyncProviders()).toHaveLength(0);
    });
  });

  describe('getModels', () => {
    it('should get stored models for provider', async () => {
      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }],
      });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      const models = manager.getModels(PROVIDER_TYPE.OPENAI);
      expect(models.length).toBe(2);
      expect(models.some((m) => m.id === 'gpt-4o')).toBe(true);
    });

    it('should filter to active only by default', async () => {
      // First, pre-populate an inactive model directly
      const insertStmt = db.prepare(`INSERT INTO provider_models 
        (provider, model_id, discovered_at, last_synced_at, is_active, match_regex) 
        VALUES (?, ?, ?, ?, 0, NULL)`);
      insertStmt.run('openai', 'old-model', Date.now(), Date.now());

      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }],
      });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      const models = manager.getModels(PROVIDER_TYPE.OPENAI);
      expect(models.length).toBe(1);
      expect(models[0]!.id).toBe('gpt-4o');
    });

    it('should include inactive when activeOnly is false', async () => {
      // First, pre-populate an inactive model
      const insertStmt = db.prepare(`INSERT INTO provider_models 
        (provider, model_id, discovered_at, last_synced_at, is_active, match_regex) 
        VALUES (?, ?, ?, ?, 0, NULL)`);
      insertStmt.run('openai', 'old-model', Date.now(), Date.now());

      global.fetch = mockFetch({ data: [{ id: 'gpt-4o' }] });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      const models = manager.getModels(PROVIDER_TYPE.OPENAI, {
        activeOnly: false,
      });
      expect(models.length).toBe(2);
    });
  });

  describe('getSyncHistory', () => {
    it('should get sync history', async () => {
      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }],
      });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      const history = manager.getSyncHistory(PROVIDER_TYPE.OPENAI, 10);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]!.provider).toBe(PROVIDER_TYPE.OPENAI);
    });

    it('should filter history by provider', async () => {
      global.fetch = mockFetch({ data: [{ id: 'model-1' }] });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      // Mock different response for Anthropic
      global.fetch = mockFetch({
        models: [{ id: 'claude-3' }],
      });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.ANTHROPIC,
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      const openaiHistory = manager.getSyncHistory(PROVIDER_TYPE.OPENAI, 10);
      expect(openaiHistory.every((h) => h.provider === PROVIDER_TYPE.OPENAI)).toBe(
        true
      );
    });

    it('should respect limit parameter', async () => {
      global.fetch = mockFetch({ data: [{ id: 'gpt-4o' }] });

      // Run multiple syncs
      for (let i = 0; i < 5; i++) {
        await manager.syncProvider({
          provider: PROVIDER_TYPE.OPENAI,
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          autoSyncIntervalMs: 24 * 60 * 60 * 1000,
        });
      }

      const history = manager.getSyncHistory(PROVIDER_TYPE.OPENAI, 3);
      expect(history.length).toBeLessThanOrEqual(3);
    });
  });
});

describe('Model Fetchers', () => {
  describe('OpenAIModelFetcher', () => {
    it('should fetch and parse OpenAI models', async () => {
      global.fetch = mockFetch({
        data: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            description: 'Latest GPT-4 model',
            context_window: 128000,
            pricing: { input: 0.005, output: 0.015 },
          },
        ],
      });

      const fetcher = new OpenAIModelFetcher();
      const models = await fetcher.fetchModels(
        'https://api.openai.com/v1',
        'sk-test'
      );

      expect(models.length).toBe(1);
      expect(models[0]!.id).toBe('gpt-4o');
      expect(models[0]!.name).toBe('GPT-4o');
      expect(models[0]!.contextLength).toBe(128000);
      expect(models[0]!.pricing).toEqual({ input: 0.005, output: 0.015 });
    });

    it('should handle missing optional fields', async () => {
      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }],
      });

      const fetcher = new OpenAIModelFetcher();
      const models = await fetcher.fetchModels(
        'https://api.openai.com/v1',
        'sk-test'
      );

      expect(models[0]!.id).toBe('gpt-4o');
      expect(models[0]!.name).toBe('gpt-4o'); // Falls back to id
      expect(models[0]!.description).toBeUndefined();
      expect(models[0]!.contextLength).toBeUndefined();
    });
  });

  describe('AnthropicModelFetcher', () => {
    it('should fetch and parse Anthropic models', async () => {
      global.fetch = mockFetch({
        models: [
          {
            id: 'claude-3-opus-20240229',
            display_name: 'Claude 3 Opus',
            description: 'Most capable Claude model',
            context_window: 200000,
          },
        ],
      });

      const fetcher = new AnthropicModelFetcher();
      const models = await fetcher.fetchModels(
        'https://api.anthropic.com/v1',
        'sk-test'
      );

      expect(models.length).toBe(1);
      expect(models[0]!.id).toBe('claude-3-opus-20240229');
      expect(models[0]!.name).toBe('Claude 3 Opus');
    });
  });

  describe('GeminiModelFetcher', () => {
    it('should fetch and parse Gemini models', async () => {
      global.fetch = mockFetch({
        models: [
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            description: 'Latest Gemini model',
            inputTokenLimit: 1000000,
            outputTokenLimit: 8192,
          },
        ],
        nextPageToken: undefined,
      });

      const fetcher = new GeminiModelFetcher();
      const models = await fetcher.fetchModels(
        'https://generativelanguage.googleapis.com/v1beta',
        'api-key'
      );

      expect(models.length).toBe(1);
      expect(models[0]!.id).toBe('gemini-1.5-pro');
      expect(models[0]!.name).toBe('Gemini 1.5 Pro');
      expect(models[0]!.contextLength).toBe(1008192); // Sum of input + output
    });

    it('should handle pagination', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        callCount++;

        if (!urlStr.includes('pageToken')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                models: [{ name: 'models/gemini-1' }],
                nextPageToken: 'next-page',
              }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: 'models/gemini-2' }],
            }),
        } as Response);
      });

      const fetcher = new GeminiModelFetcher();
      const models = await fetcher.fetchModels(
        'https://generativelanguage.googleapis.com/v1beta',
        'api-key'
      );

      expect(callCount).toBe(2);
      expect(models.length).toBe(2);
    });
  });
});

describe('Type Guards', () => {
  describe('isProviderType', () => {
    it('should validate valid providers', () => {
      expect(isProviderType('openai')).toBe(true);
      expect(isProviderType('groq')).toBe(true);
      expect(isProviderType('anthropic')).toBe(true);
      expect(isProviderType('gemini')).toBe(true);
      expect(isProviderType('openrouter')).toBe(true);
    });

    it('should reject invalid providers', () => {
      expect(isProviderType('invalid')).toBe(false);
      expect(isProviderType('')).toBe(false);
      expect(isProviderType(null)).toBe(false);
      expect(isProviderType(undefined)).toBe(false);
      expect(isProviderType(123)).toBe(false);
    });
  });

  describe('isSupportedProvider', () => {
    it('should check if provider has a fetcher', () => {
      expect(isSupportedProvider('openai')).toBe(true);
      expect(isSupportedProvider('groq')).toBe(true);
      expect(isSupportedProvider('invalid')).toBe(false);
    });
  });

  describe('getFetcherForProvider', () => {
    it('should return fetcher for supported providers', () => {
      const fetcher = getFetcherForProvider(PROVIDER_TYPE.OPENAI);
      expect(fetcher).not.toBeNull();
      expect(fetcher).toBeInstanceOf(OpenAIModelFetcher);
    });

    it('should return null for unsupported providers', () => {
      const fetcher = getFetcherForProvider('invalid' as ProviderType);
      expect(fetcher).toBeNull();
    });
  });
});
