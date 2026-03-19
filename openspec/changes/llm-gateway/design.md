# Design: LLM Gateway — Phase 1

**Change**: `llm-gateway`
**Status**: Phase 1 Design
**Date**: 2026-03-19
**Derived from**: `spec.md`

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    LLM Gateway                            │
│                                                           │
│  Transports          Core              Storage            │
│  ┌─────────┐    ┌───────────┐    ┌──────────────┐       │
│  │  MCP    │───▶│           │    │  Credential  │       │
│  │ (stdio) │    │  Router   │◀──▶│  Vault       │       │
│  └─────────┘    │           │    │  (SQLite +   │       │
│  ┌─────────┐    │           │    │   AES-256)   │       │
│  │  HTTP   │───▶│           │    └──────────────┘       │
│  │ (Hono)  │    └─────┬─────┘                           │
│  └─────────┘          │                                  │
│                  ┌─────┴──────┐                          │
│                  │  Adapters  │                          │
│          ┌───────┼───────┬────┼───────┐                 │
│          ▼       ▼       ▼    ▼       ▼                 │
│       Anthropic OpenAI  Claude Gemini  Codex            │
│       (SDK)    (SDK)   (CLI)  (CLI)   (CLI)             │
└──────────────────────────────────────────────────────────┘
```

## Directory Structure

```
mcp-llm-bridge/
├── src/
│   ├── index.ts              # Entrypoint — startup, mode detection
│   ├── server/
│   │   ├── mcp.ts            # MCP server setup + tool handlers
│   │   └── http.ts           # Hono HTTP server + route handlers
│   ├── core/
│   │   ├── router.ts         # Provider selection + fallback logic
│   │   ├── types.ts          # Shared interfaces + types
│   │   └── config.ts         # Environment config with defaults
│   ├── vault/
│   │   ├── vault.ts          # Credential CRUD (encrypt/decrypt)
│   │   ├── crypto.ts         # AES-256-GCM encrypt/decrypt helpers
│   │   └── schema.ts         # SQLite table creation
│   ├── adapters/
│   │   ├── anthropic.ts      # Anthropic SDK adapter
│   │   ├── openai.ts         # OpenAI SDK adapter
│   │   ├── cli-claude.ts     # Claude CLI adapter (migrated)
│   │   ├── cli-gemini.ts     # Gemini CLI adapter (migrated)
│   │   ├── cli-codex.ts      # Codex CLI adapter (migrated)
│   │   ├── cli-copilot.ts    # Copilot CLI adapter (migrated)
│   │   └── index.ts          # Adapter registry
│   └── detect.ts             # CLI detection (migrated)
├── test/
│   ├── vault.test.ts         # Vault roundtrip tests
│   ├── router.test.ts        # Router logic tests
│   └── adapters.test.ts      # Adapter interface tests
├── tsconfig.json
├── package.json
└── .env.example
```

## Type System

### Core Types (`src/core/types.ts`)

```typescript
// === Provider Interface ===

export type ProviderType = 'api' | 'cli';

export interface ModelInfo {
  id: string;           // e.g. "claude-sonnet-4-20250514"
  name: string;         // e.g. "Claude Sonnet 4"
  provider: string;     // e.g. "anthropic"
  maxTokens: number;    // Max output tokens
}

export interface LLMProvider {
  id: string;
  name: string;
  type: ProviderType;
  models: ModelInfo[];

  generate(request: GenerateRequest): Promise<GenerateResponse>;
  isAvailable(): Promise<boolean>;
}

// === Request/Response ===

export interface GenerateRequest {
  prompt: string;
  system?: string;
  provider?: string;    // Preferred provider ID
  model?: string;       // Specific model ID
  maxTokens?: number;   // Default: 4096
}

export interface GenerateResponse {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

// === Credential ===

export interface StoredCredential {
  id: number;
  provider: string;
  keyName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaskedCredential extends StoredCredential {
  maskedValue: string;  // "sk-ant-...***"
}

// === Config ===

export interface GatewayConfig {
  masterKey: string;
  dbPath: string;
  httpPort: number;
  httpEnabled: boolean;
}
```

## Data Model

### SQLite Schema (`vault.db`)

```sql
CREATE TABLE IF NOT EXISTS credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,            -- "anthropic", "openai"
  key_name      TEXT NOT NULL DEFAULT 'default',
  encrypted_value BLOB NOT NULL,          -- AES-256-GCM ciphertext
  iv            BLOB NOT NULL,            -- 12 bytes
  auth_tag      BLOB NOT NULL,            -- 16 bytes
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, key_name)
);
```

**Notes:**
- `UNIQUE(provider, key_name)` — one key per provider per name slot (e.g. anthropic/default, anthropic/work)
- Upsert on store: if `(provider, key_name)` exists, update it
- Values stored as raw bytes (Buffer), not base64

## Encryption Design

### Key Derivation

```typescript
// Master key source (in priority order):
// 1. LLM_GATEWAY_MASTER_KEY env var (hex string, 32 bytes)
// 2. Read from ~/.llm-gateway/master.key
// 3. Generate random 32 bytes, save to ~/.llm-gateway/master.key

function getMasterKey(): Buffer {
  const envKey = process.env.LLM_GATEWAY_MASTER_KEY;
  if (envKey) return Buffer.from(envKey, 'hex');

  const keyPath = path.join(configDir, 'master.key');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);

  const key = crypto.randomBytes(32);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}
```

### Encrypt/Decrypt

```typescript
// AES-256-GCM — same pattern as ghagga
function encrypt(plaintext: string, masterKey: Buffer): EncryptedData {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted, iv, authTag };
}

function decrypt(data: EncryptedData, masterKey: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, data.iv);
  decipher.setAuthTag(data.authTag);
  return Buffer.concat([decipher.update(data.encrypted), decipher.final()]).toString('utf8');
}
```

## Provider Adapters

### Anthropic Adapter

```typescript
export class AnthropicAdapter implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic';
  type = 'api' as const;
  models = [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', maxTokens: 8192 },
    { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', provider: 'anthropic', maxTokens: 8192 },
  ];

  constructor(private vault: Vault) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = await this.vault.getDecrypted('anthropic');
    const client = new Anthropic({ apiKey });

    const model = request.model ?? 'claude-sonnet-4-20250514';
    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      text,
      provider: this.id,
      model,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.vault.has('anthropic');
  }
}
```

### OpenAI Adapter

```typescript
export class OpenAIAdapter implements LLMProvider {
  id = 'openai';
  name = 'OpenAI';
  type = 'api' as const;
  models = [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', maxTokens: 4096 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', maxTokens: 4096 },
    { id: 'o3-mini', name: 'o3-mini', provider: 'openai', maxTokens: 4096 },
  ];

  constructor(private vault: Vault) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = await this.vault.getDecrypted('openai');
    const client = new OpenAI({ apiKey });

    const model = request.model ?? 'gpt-4o';
    const messages: Array<{role: string; content: string}> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      provider: this.id,
      model,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.vault.has('openai');
  }
}
```

### CLI Adapters

CLI adapters are migrated from current `generate.js` into individual files implementing `LLMProvider`. Each wraps the existing `execSync` logic. They don't use the vault — they rely on CLI authentication.

```typescript
// Example: cli-claude.ts
export class ClaudeCliAdapter implements LLMProvider {
  id = 'claude-cli';
  name = 'Claude CLI';
  type = 'cli' as const;
  models = [{ id: 'claude-cli', name: 'Claude (CLI)', provider: 'claude-cli', maxTokens: 8192 }];

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    // Existing execSync logic from generate.js, typed
  }

  async isAvailable(): Promise<boolean> {
    // Existing detection logic from detect.js
  }
}
```

## Router Design

```typescript
export class Router {
  private providers: LLMProvider[] = [];

  register(provider: LLMProvider): void {
    this.providers.push(provider);
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const candidates = await this.resolveCandidates(request);

    for (const provider of candidates) {
      try {
        return await provider.generate(request);
      } catch (error) {
        console.error(`[gateway] ${provider.id} failed: ${error}`);
        continue;
      }
    }

    throw new Error('All providers failed. Store credentials via vault_store or install a CLI tool.');
  }

  private async resolveCandidates(request: GenerateRequest): Promise<LLMProvider[]> {
    const available = [];
    for (const p of this.providers) {
      if (await p.isAvailable()) available.push(p);
    }

    // 1. If model specified, find provider that has that model
    if (request.model) {
      const modelProvider = available.find(p =>
        p.models.some(m => m.id === request.model)
      );
      if (modelProvider) {
        return [modelProvider, ...available.filter(p => p !== modelProvider)];
      }
    }

    // 2. If provider specified, put it first
    if (request.provider) {
      const preferred = available.find(p => p.id === request.provider);
      if (preferred) {
        return [preferred, ...available.filter(p => p !== preferred)];
      }
    }

    // 3. Default: API providers first, then CLI
    return available.sort((a, b) => {
      if (a.type === 'api' && b.type === 'cli') return -1;
      if (a.type === 'cli' && b.type === 'api') return 1;
      return 0;
    });
  }
}
```

## HTTP API Design (`src/server/http.ts`)

```typescript
import { Hono } from 'hono';

const app = new Hono();

// Generate
app.post('/v1/generate', async (c) => {
  const body = await c.req.json<GenerateRequest>();
  const result = await router.generate(body);
  return c.json(result);
});

// Models
app.get('/v1/models', async (c) => {
  const models = router.getAvailableModels();
  return c.json({ models });
});

// Providers
app.get('/v1/providers', async (c) => {
  const statuses = await router.getProviderStatuses();
  return c.json({ providers: statuses });
});

// Credentials CRUD
app.post('/v1/credentials', async (c) => {
  const { provider, keyName, apiKey } = await c.req.json();
  const id = vault.store(provider, keyName ?? 'default', apiKey);
  return c.json({ id, provider, keyName }, 201);
});

app.get('/v1/credentials', async (c) => {
  const creds = vault.listMasked();
  return c.json({ credentials: creds });
});

app.delete('/v1/credentials/:id', async (c) => {
  vault.delete(Number(c.req.param('id')));
  return c.json({ ok: true });
});
```

## MCP Tool Handlers (`src/server/mcp.ts`)

Tools registered on the MCP server:

| Tool | Input Schema | Handler |
|------|-------------|---------|
| `llm_generate` | `{ prompt, system?, provider?, model?, maxTokens? }` | `router.generate(request)` |
| `vault_store` | `{ provider, keyName?, apiKey }` | `vault.store(...)` |
| `vault_list` | `{}` | `vault.listMasked()` |
| `vault_delete` | `{ id }` | `vault.delete(id)` |
| `llm_models` | `{}` | `router.getAvailableModels()` |

`llm_generate` is backward compatible: `prompt` is the only required field, same as today.

## Entrypoint Logic (`src/index.ts`)

```typescript
// Parse mode from argv
const mode = process.argv[2]; // "serve" | "--http" | undefined

// Initialize shared components
const config = loadConfig();
const vault = new Vault(config);
const router = new Router();

// Register adapters
router.register(new AnthropicAdapter(vault));
router.register(new OpenAIAdapter(vault));
router.register(new ClaudeCliAdapter());
router.register(new GeminiCliAdapter());
router.register(new CodexCliAdapter());
router.register(new CopilotCliAdapter());

if (mode === 'serve') {
  // HTTP only
  startHttpServer(router, vault, config);
} else {
  // MCP stdio (default — backward compatible)
  startMcpServer(router, vault);
  if (mode === '--http') {
    startHttpServer(router, vault, config);
  }
}
```

## Configuration (`src/core/config.ts`)

| Env Var | Default | Purpose |
|---------|---------|---------|
| `LLM_GATEWAY_MASTER_KEY` | auto-generate | Hex-encoded 32-byte AES key |
| `LLM_GATEWAY_DB_PATH` | `~/.llm-gateway/vault.db` | SQLite database path |
| `LLM_GATEWAY_PORT` | `3456` | HTTP server port |

## Dependencies (new)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@anthropic-ai/sdk": "^0.39.0",
    "openai": "^4.78.0",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0",
    "better-sqlite3": "^11.8.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "tsup": "^8.3.0",
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite over PostgreSQL | Single file, zero config, perfect for single-instance credential store |
| AES-256-GCM over bcrypt | Need reversible encryption (must decrypt keys to use them), not hashing |
| Hono over Express | Lighter, TypeScript-native, same API style |
| Vault as class, not module | Needs to hold master key + DB connection as instance state |
| CLI adapters as separate files | Each implements LLMProvider — uniform interface, easy to add/remove |
| Provider in vault keyed by `(provider, key_name)` | Allows multiple keys per provider (e.g. personal vs work) |
| No streaming in Phase 1 | Simpler implementation, sufficient for current use cases |
| `v1` prefix on HTTP routes | Future-proofs the API for breaking changes |
