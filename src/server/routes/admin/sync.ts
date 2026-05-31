import type { Context, Hono } from 'hono';
import type Database from 'better-sqlite3';

import type { Vault } from '../../../vault/vault.js';
import {
  ModelSyncAlreadyRunningError,
  ModelSyncManager,
  isProviderType,
  PROVIDER_TYPE,
  type ProviderType,
} from '../../../model-sync/index.js';
import { PriceManager, PriceSyncAlreadyRunningError } from '../../../price-sync/index.js';
import {
  resolveProviderApiKey,
  resolveProviderApiKeyEnv,
  resolveProviderBaseUrl,
} from '../../../core/provider-runtime-config.js';

export interface AdminSyncRoutesDeps {
  db?: Database.Database;
  vault: Vault;
}

const supportedSyncProviders = Object.values(PROVIDER_TYPE);
const defaultSyncHistoryLimit = 100;
const maxSyncHistoryLimit = 500;

const DEFAULT_PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  [PROVIDER_TYPE.OPENAI]: 'https://api.openai.com/v1',
  [PROVIDER_TYPE.GROQ]: 'https://api.groq.com/openai/v1',
  [PROVIDER_TYPE.OPENROUTER]: 'https://openrouter.ai/api/v1',
  [PROVIDER_TYPE.ANTHROPIC]: 'https://api.anthropic.com/v1',
  [PROVIDER_TYPE.GEMINI]: 'https://generativelanguage.googleapis.com/v1beta',
};

function jsonError(
  c: Context,
  status: 400 | 404 | 409 | 500 | 503,
  error: string,
  code: string,
  details?: Record<string, unknown>,
) {
  return c.json(details ? { error, code, details } : { error, code }, status);
}

function validateProvider(
  value: unknown,
  field: string,
): { ok: true; provider: ProviderType } | { ok: false; error: string; details: Record<string, unknown> } {
  if (!isProviderType(value)) {
    return {
      ok: false,
      error: `Invalid provider for ${field}`,
      details: {
        field,
        received: value ?? null,
        supportedProviders: supportedSyncProviders,
      },
    };
  }

  return { ok: true, provider: value };
}

function validateOptionalProvider(
  value: string | undefined,
  field: string,
): { ok: true; provider: ProviderType | undefined } | { ok: false; error: string; details: Record<string, unknown> } {
  if (value === undefined) {
    return { ok: true, provider: undefined };
  }

  const result = validateProvider(value, field);
  if (!result.ok) {
    return result;
  }

  return { ok: true, provider: result.provider };
}

function validateLimit(
  value: string | undefined,
  field: string,
): { ok: true; limit: number } | { ok: false; error: string; details: Record<string, unknown> } {
  if (value === undefined) {
    return { ok: true, limit: defaultSyncHistoryLimit };
  }

  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      error: `Invalid numeric value for ${field}`,
      details: {
        field,
        received: value,
        min: 1,
        max: maxSyncHistoryLimit,
      },
    };
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxSyncHistoryLimit) {
    return {
      ok: false,
      error: `Invalid numeric value for ${field}`,
      details: {
        field,
        received: value,
        min: 1,
        max: maxSyncHistoryLimit,
      },
    };
  }

  return { ok: true, limit };
}

export function registerAdminSyncRoutes(app: Hono, deps: AdminSyncRoutesDeps): void {
  app.post('/v1/admin/models/sync', async (c) => {
    try {
      if (!deps.db) {
        return jsonError(c, 500, 'Database not configured', 'NOT_CONFIGURED');
      }

      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonError(c, 400, 'Request body must be a JSON object', 'INVALID_JSON', {
          expected: 'object',
        });
      }

      const requestBody = body as Record<string, unknown>;
      const provider = requestBody['provider'];

      const providerValidation = validateProvider(provider, 'provider');
      if (!providerValidation.ok) {
        return jsonError(c, 400, providerValidation.error, 'VALIDATION_ERROR', providerValidation.details);
      }

      const resolvedProvider = providerValidation.provider;
      const requestedBaseUrl = typeof requestBody['baseUrl'] === 'string' ? requestBody['baseUrl'] : undefined;

      const baseUrl =
        requestedBaseUrl ??
        resolveProviderBaseUrl(resolvedProvider) ??
        DEFAULT_PROVIDER_BASE_URLS[resolvedProvider];

      let apiKey: string | undefined = typeof requestBody['apiKey'] === 'string' ? requestBody['apiKey'] : undefined;
      if (!apiKey) {
        const envKey = resolveProviderApiKey(resolvedProvider);
        if (envKey) {
          apiKey = envKey;
        } else {
          try {
            apiKey = deps.vault.getDecrypted(resolvedProvider, 'default');
          } catch {
            // vault doesn't have this credential
          }
        }
      }

      if (!apiKey) {
        return jsonError(
          c,
          400,
          `No API key found for provider: ${resolvedProvider}`,
          'MISSING_CREDENTIALS',
          {
              provider: resolvedProvider,
              resolution: [
                'Provide apiKey in the request body',
                `Set ${resolveProviderApiKeyEnv(resolvedProvider)} in the environment`,
                'Store a default credential in the vault',
              ],
            },
        );
      }

      const matchRegex = typeof requestBody['matchRegex'] === 'string' ? requestBody['matchRegex'] : undefined;
      const autoSyncIntervalMs =
        typeof requestBody['autoSyncIntervalMs'] === 'number'
          ? requestBody['autoSyncIntervalMs']
          : 24 * 60 * 60 * 1000;

      const syncManager = new ModelSyncManager(deps.db);
      let result;
      try {
        result = await syncManager.syncProvider({
          provider: resolvedProvider,
          baseUrl,
          apiKey,
          matchRegex,
          autoSyncIntervalMs,
        });
      } catch (error) {
        if (error instanceof ModelSyncAlreadyRunningError) {
          return jsonError(c, 409, 'Model sync already running', 'SYNC_ALREADY_RUNNING', {
            provider: resolvedProvider,
            activeRun: error.status,
          });
        }

        throw error;
      }

      return c.json({
        ok: true,
        provider: result.provider,
        synced: result.modelsFound.length,
        models: result.modelsFound,
        added: result.modelsAdded,
        removed: result.modelsRemoved,
        timestamp: result.timestamp,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, 500, message, 'INTERNAL_ERROR');
    }
  });

  app.get('/v1/admin/models/sync/status', (c) => {
    try {
      if (!deps.db) {
        return jsonError(c, 500, 'Database not configured', 'NOT_CONFIGURED');
      }

      const provider = c.req.query('provider') ?? undefined;
      const providerValidation = validateOptionalProvider(provider, 'provider');
      if (!providerValidation.ok) {
        return jsonError(c, 400, providerValidation.error, 'VALIDATION_ERROR', providerValidation.details);
      }

      const syncManager = new ModelSyncManager(deps.db);
      const statuses = providerValidation.provider
        ? [syncManager.getRunStatus(providerValidation.provider)]
        : supportedSyncProviders.map((supportedProvider) => syncManager.getRunStatus(supportedProvider));

      return c.json({
        statuses,
        count: statuses.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, 500, message, 'INTERNAL_ERROR');
    }
  });

  app.get('/v1/admin/models/sync/history', (c) => {
    try {
      if (!deps.db) {
        return jsonError(c, 500, 'Database not configured', 'NOT_CONFIGURED');
      }

      const provider = c.req.query('provider') ?? undefined;
      const limitStr = c.req.query('limit');

      const providerValidation = validateOptionalProvider(provider, 'provider');
      if (!providerValidation.ok) {
        return jsonError(c, 400, providerValidation.error, 'VALIDATION_ERROR', providerValidation.details);
      }

      const limitValidation = validateLimit(limitStr, 'limit');
      if (!limitValidation.ok) {
        return jsonError(c, 400, limitValidation.error, 'VALIDATION_ERROR', limitValidation.details);
      }

      const syncManager = new ModelSyncManager(deps.db);
      const history = syncManager.getSyncHistory(
        providerValidation.provider,
        limitValidation.limit,
      );

      return c.json({
        history: history.map((h) => ({
          id: h.id,
          provider: h.provider,
          syncedAt: h.syncedAt,
          modelsFound: h.modelsFound,
          modelsAdded: h.modelsAdded,
          modelsRemoved: h.modelsRemoved,
          error: h.error,
        })),
        count: history.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, 500, message, 'INTERNAL_ERROR');
    }
  });

  app.post('/v1/admin/prices/sync', async (c) => {
    try {
      if (!deps.db) {
        return jsonError(c, 500, 'Database not configured', 'NOT_CONFIGURED');
      }

      const body = await c.req.json().catch(() => undefined);
      if (body !== undefined) {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return jsonError(c, 400, 'Request body must be a JSON object', 'INVALID_JSON', {
            expected: 'object',
          });
        }

        const requestBody = body as Record<string, unknown>;

        if ('provider' in requestBody) {
          const provider = requestBody['provider'];
          if (!isProviderType(provider)) {
            return jsonError(c, 400, 'Invalid provider for provider parameter', 'VALIDATION_ERROR', {
              field: 'provider',
              received: provider ?? null,
              supportedProviders: supportedSyncProviders,
            });
          }

          return jsonError(
            c,
            400,
            'Provider-scoped price sync is not supported by this endpoint',
            'UNSUPPORTED_PARAMETER',
            {
              field: 'provider',
              received: provider,
            },
          );
        }
      }

      const priceManager = new PriceManager(deps.db);
      let result;
      try {
        result = await priceManager.syncPrices();
      } catch (error) {
        if (error instanceof PriceSyncAlreadyRunningError) {
          return jsonError(c, 409, 'Price sync already running', 'SYNC_ALREADY_RUNNING', {
            activeRun: error.status,
          });
        }

        throw error;
      }

      return c.json({ ok: true, synced: result.added + result.updated, details: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, 500, message, 'INTERNAL_ERROR');
    }
  });

  app.get('/v1/admin/prices/sync/status', (c) => {
    try {
      if (!deps.db) {
        return jsonError(c, 500, 'Database not configured', 'NOT_CONFIGURED');
      }

      const priceManager = new PriceManager(deps.db);
      return c.json(priceManager.getRunStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, 500, message, 'INTERNAL_ERROR');
    }
  });

  app.get('/v1/admin/prices/sync/history', (c) => {
    try {
      if (!deps.db) {
        return jsonError(c, 500, 'Database not configured', 'NOT_CONFIGURED');
      }

      const limitStr = c.req.query('limit');
      const limitValidation = validateLimit(limitStr, 'limit');
      if (!limitValidation.ok) {
        return jsonError(c, 400, limitValidation.error, 'VALIDATION_ERROR', limitValidation.details);
      }

      const priceManager = new PriceManager(deps.db);
      const history = priceManager.getSyncHistory(limitValidation.limit);

      return c.json({
        history: history.map((entry) => ({
          id: entry.id,
          syncedAt: entry.syncedAt,
          modelsUpdated: entry.modelsUpdated,
          modelsAdded: entry.modelsAdded,
          error: entry.error,
        })),
        count: history.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, 500, message, 'INTERNAL_ERROR');
    }
  });
}
