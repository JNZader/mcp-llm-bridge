/**
 * TDD Tests for Model Sync Fetchers
 *
 * Feature 8: Auto Model Sync
 * Following Red -> Green -> Refactor cycle
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  ModelSyncAlreadyRunningError,
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
            for (const [, row] of tables.provider_models) {
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
            return Array.from(tables.model_sync_log.values())
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
  return () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(response),
    } as Response);
}

function mockFetchError(status: number): typeof fetch {
  return () =>
    Promise.resolve({
      ok: false,
      status,
    } as Response);
}

// === Tests ===

describe('ModelSyncManager', () => {
  let db: Database;
  let manager: ModelSyncManager;
  const originalFetch = global.fetch;

  beforeEach(() => {
    db = createMockDatabase();
    ModelSyncManager.resetRuntimeState();
    manager = createModelSyncManager(db);
  });

  afterEach(() => {
    manager.stopAllAutoSync();
    global.fetch = originalFetch;
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

      assert.strictEqual(result.modelsFound.length, 2);
      assert.strictEqual(result.modelsFound.some((m) => m.id === 'gpt-4o'), true);
      assert.strictEqual(result.provider, PROVIDER_TYPE.OPENAI);
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
        matchRegex: '^gpt-4',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      assert.strictEqual(result.modelsFound.length, 2);
      assert.strictEqual(result.modelsFound.every((m) => m.id.startsWith('gpt-4')), true);
    });

    it('should detect added and removed models', async () => {
      const stmt = db.prepare(`INSERT INTO provider_models 
        (provider, model_id, discovered_at, last_synced_at, is_active) 
        VALUES (?, ?, ?, ?, 1)`);
      stmt.run('openai', 'old-model', Date.now(), Date.now());

      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }],
      });

      const result = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      assert.strictEqual(result.modelsAdded.length, 1);
      assert.strictEqual(result.modelsAdded[0]?.id, 'gpt-4o');
      assert.strictEqual(result.modelsRemoved.length, 1);
      assert.strictEqual(result.modelsRemoved[0], 'old-model');
    });

    it('should handle fetch errors', async () => {
      global.fetch = mockFetchError(401);

      await assert.rejects(
        async () =>
          manager.syncProvider({
            provider: PROVIDER_TYPE.OPENAI,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'invalid-key',
            autoSyncIntervalMs: 24 * 60 * 60 * 1000,
          }),
        /Failed to fetch models/
      );
    });

    it('should handle invalid regex gracefully', async () => {
      global.fetch = mockFetch({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }],
      });

      const result = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        matchRegex: '[invalid(',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      assert.strictEqual(result.modelsFound.length, 2);
    });

    it('should reject overlapping syncs for the same provider and release the lock on success', async () => {
      let resolveFetch: ((value: Response) => void) | undefined;
      global.fetch = (() =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })) as typeof fetch;

      const firstSync = manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      await Promise.resolve();

      const runningStatus = manager.getRunStatus(PROVIDER_TYPE.OPENAI);
      assert.strictEqual(runningStatus.isRunning, true);
      assert.ok(runningStatus.startedAt);

      await assert.rejects(
        async () =>
          manager.syncProvider({
            provider: PROVIDER_TYPE.OPENAI,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            autoSyncIntervalMs: 24 * 60 * 60 * 1000,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ModelSyncAlreadyRunningError);
          assert.strictEqual(error.status.provider, PROVIDER_TYPE.OPENAI);
          assert.strictEqual(error.status.isRunning, true);
          assert.ok(error.status.startedAt);
          return true;
        }
      );

      resolveFetch?.({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }] }),
      } as Response);

      await firstSync;

      const completedStatus = manager.getRunStatus(PROVIDER_TYPE.OPENAI);
      assert.strictEqual(completedStatus.isRunning, false);
      assert.strictEqual(completedStatus.startedAt, null);
      assert.ok(completedStatus.lastCompletedAt);
      assert.strictEqual(completedStatus.lastSuccessAt, completedStatus.lastCompletedAt);
      assert.strictEqual(completedStatus.lastError, null);
      assert.strictEqual(completedStatus.lastResultSummary?.modelsFound, 1);
    });

    it('should release the lock and capture error status after failure', async () => {
      global.fetch = mockFetchError(500);

      await assert.rejects(
        async () =>
          manager.syncProvider({
            provider: PROVIDER_TYPE.OPENAI,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            autoSyncIntervalMs: 24 * 60 * 60 * 1000,
          }),
        /Failed to fetch models/
      );

      const status = manager.getRunStatus(PROVIDER_TYPE.OPENAI);
      assert.strictEqual(status.isRunning, false);
      assert.strictEqual(status.startedAt, null);
      assert.ok(status.lastCompletedAt);
      assert.strictEqual(status.lastSuccessAt, null);
      assert.match(status.lastError ?? '', /Failed to fetch models/);
      assert.match(status.lastResultSummary?.error ?? '', /Failed to fetch models/);

      global.fetch = mockFetch({ data: [{ id: 'gpt-4o' }] });

      const recovery = await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

      assert.strictEqual(recovery.modelsFound.length, 1);
      assert.strictEqual(manager.getRunStatus(PROVIDER_TYPE.OPENAI).isRunning, false);
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

      assert.strictEqual(manager.isAutoSyncRunning(PROVIDER_TYPE.OPENAI), true);
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
      assert.strictEqual(manager.isAutoSyncRunning(PROVIDER_TYPE.OPENAI), false);
    });

    it('should track running auto-sync providers', () => {
      global.fetch = ((url: string | URL) => {
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
      }) as typeof fetch;

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
      assert.ok(running.includes(PROVIDER_TYPE.OPENAI));
      assert.ok(running.includes(PROVIDER_TYPE.ANTHROPIC));
    });

    it('should stop all auto-sync on stopAllAutoSync', () => {
      global.fetch = ((url: string | URL) => {
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
      }) as typeof fetch;

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
      assert.strictEqual(manager.getRunningAutoSyncProviders().length, 0);
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
      assert.strictEqual(models.length, 2);
      assert.strictEqual(models.some((m) => m.id === 'gpt-4o'), true);
    });

    it('should filter to active only by default', async () => {
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
      assert.strictEqual(models.length, 1);
      assert.strictEqual(models[0]?.id, 'gpt-4o');
    });

    it('should include inactive when activeOnly is false', async () => {
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
      assert.strictEqual(models.length, 2);
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
      assert.ok(history.length > 0);
      assert.strictEqual(history[0]?.provider, PROVIDER_TYPE.OPENAI);
    });

    it('should filter history by provider', async () => {
      global.fetch = mockFetch({ data: [{ id: 'model-1' }] });

      await manager.syncProvider({
        provider: PROVIDER_TYPE.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        autoSyncIntervalMs: 24 * 60 * 60 * 1000,
      });

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
      assert.strictEqual(
        openaiHistory.every((h) => h.provider === PROVIDER_TYPE.OPENAI),
        true
      );
    });

    it('should respect limit parameter', async () => {
      global.fetch = mockFetch({ data: [{ id: 'gpt-4o' }] });

      for (let i = 0; i < 5; i++) {
        await manager.syncProvider({
          provider: PROVIDER_TYPE.OPENAI,
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          autoSyncIntervalMs: 24 * 60 * 60 * 1000,
        });
      }

      const history = manager.getSyncHistory(PROVIDER_TYPE.OPENAI, 3);
      assert.ok(history.length <= 3);
    });
  });
});

describe('Model Fetchers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

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

      assert.strictEqual(models.length, 1);
      assert.strictEqual(models[0]?.id, 'gpt-4o');
      assert.strictEqual(models[0]?.name, 'GPT-4o');
      assert.strictEqual(models[0]?.contextLength, 128000);
      assert.deepStrictEqual(models[0]?.pricing, { input: 0.005, output: 0.015 });
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

      assert.strictEqual(models[0]?.id, 'gpt-4o');
      assert.strictEqual(models[0]?.name, 'gpt-4o');
      assert.strictEqual(models[0]?.description, undefined);
      assert.strictEqual(models[0]?.contextLength, undefined);
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

      assert.strictEqual(models.length, 1);
      assert.strictEqual(models[0]?.id, 'claude-3-opus-20240229');
      assert.strictEqual(models[0]?.name, 'Claude 3 Opus');
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

      assert.strictEqual(models.length, 1);
      assert.strictEqual(models[0]?.id, 'gemini-1.5-pro');
      assert.strictEqual(models[0]?.name, 'Gemini 1.5 Pro');
      assert.strictEqual(models[0]?.contextLength, 1008192);
    });

    it('should handle pagination', async () => {
      let callCount = 0;
      global.fetch = ((url: string | URL) => {
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
      }) as typeof fetch;

      const fetcher = new GeminiModelFetcher();
      const models = await fetcher.fetchModels(
        'https://generativelanguage.googleapis.com/v1beta',
        'api-key'
      );

      assert.strictEqual(callCount, 2);
      assert.strictEqual(models.length, 2);
    });
  });
});

describe('Type Guards', () => {
  describe('isProviderType', () => {
    it('should validate valid providers', () => {
      assert.strictEqual(isProviderType('openai'), true);
      assert.strictEqual(isProviderType('groq'), true);
      assert.strictEqual(isProviderType('anthropic'), true);
      assert.strictEqual(isProviderType('gemini'), true);
      assert.strictEqual(isProviderType('openrouter'), true);
    });

    it('should reject invalid providers', () => {
      assert.strictEqual(isProviderType('invalid'), false);
      assert.strictEqual(isProviderType(''), false);
      assert.strictEqual(isProviderType(null), false);
      assert.strictEqual(isProviderType(undefined), false);
      assert.strictEqual(isProviderType(123), false);
    });
  });

  describe('isSupportedProvider', () => {
    it('should check if provider has a fetcher', () => {
      assert.strictEqual(isSupportedProvider('openai'), true);
      assert.strictEqual(isSupportedProvider('groq'), true);
      assert.strictEqual(isSupportedProvider('invalid'), false);
    });
  });

  describe('getFetcherForProvider', () => {
    it('should return fetcher for supported providers', () => {
      const fetcher = getFetcherForProvider(PROVIDER_TYPE.OPENAI);
      assert.notStrictEqual(fetcher, null);
      assert.ok(fetcher instanceof OpenAIModelFetcher);
    });

    it('should return null for unsupported providers', () => {
      const fetcher = getFetcherForProvider('invalid' as ProviderType);
      assert.strictEqual(fetcher, null);
    });
  });
});
