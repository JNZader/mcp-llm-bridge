# Spec: LLM Gateway — Phase 1

**Change**: `llm-gateway`
**Status**: Phase 1 Spec
**Date**: 2026-03-19
**Derived from**: `proposal.md`

---

## Requirements

### R1: TypeScript Migration

The codebase MUST be converted from JavaScript to TypeScript with strict mode.

- All existing `.js` source files → `.ts`
- `tsconfig.json` with `strict: true`, `ESNext` module, `NodeNext` resolution
- Build produces runnable JS via `tsx` (dev) or `tsup` (production)
- Existing MCP tool behavior is identical after migration

### R2: Credential Vault

The system MUST provide encrypted storage for LLM provider API keys.

- Storage: SQLite via `better-sqlite3`
- Encryption: AES-256-GCM per-value encryption using Node.js `crypto`
- Master key: derived from `LLM_GATEWAY_MASTER_KEY` env var (or auto-generated on first run and saved to `~/.llm-gateway/master.key`)
- Database location: `~/.llm-gateway/vault.db` (configurable via `LLM_GATEWAY_DB_PATH`)
- Schema: `credentials` table with `id`, `provider`, `key_name`, `encrypted_value`, `iv`, `auth_tag`, `created_at`, `updated_at`
- Operations: store, retrieve (decrypted), list (masked), delete

### R3: Direct API Adapters

The system MUST support direct API calls to Anthropic and OpenAI.

- **Anthropic adapter**: Uses `@anthropic-ai/sdk`, supports `claude-sonnet-4-20250514`, `claude-haiku-4-20250414`
- **OpenAI adapter**: Uses `openai` SDK, supports `gpt-4o`, `gpt-4o-mini`, `o3-mini`
- Each adapter implements the `LLMProvider` interface
- Credentials are fetched from the vault at call time
- Both adapters support: `prompt`, `system`, `model`, `maxTokens`

### R4: CLI Adapters (Preserved)

Existing CLI adapters MUST continue working as fallback providers.

- `claude`, `gemini`, `codex`, `copilot` CLI adapters preserved
- CLI providers have lower priority than API providers
- Detection logic unchanged (check `--version` via subprocess)

### R5: Provider Router

The system MUST route generation requests to the best available provider.

- Provider selection order: explicit `provider` param > API providers with credentials > CLI providers
- Model parameter: if `model` is specified, route to the provider that owns that model
- Fallback: if preferred provider fails, try next in priority order
- Provider registry maps provider IDs to adapter instances

### R6: HTTP Transport (Hono)

The system MUST expose an HTTP API alongside the existing MCP transport.

- Framework: Hono running on Node.js
- Port: configurable via `LLM_GATEWAY_PORT` (default: `3456`)
- Endpoints:
  - `POST /v1/generate` — generate text
  - `GET /v1/models` — list available models
  - `GET /v1/providers` — provider status
  - `POST /v1/credentials` — store credential
  - `GET /v1/credentials` — list credentials (values masked)
  - `DELETE /v1/credentials/:id` — remove credential
- JSON request/response
- Error responses use `{ error: string, code: string }` format

### R7: MCP Transport (Expanded)

The MCP server MUST keep the existing `llm_generate` tool and add credential management tools.

- `llm_generate` — backward compatible, adds optional `model` param
- `vault_store` — store a credential (`provider`, `key_name`, `api_key`)
- `vault_list` — list stored credentials (masked values)
- `vault_delete` — delete a credential by ID
- `llm_models` — list available models across all providers

### R8: Dual Transport Startup

The system MUST support running MCP (stdio) and HTTP simultaneously, or either alone.

- `mcp-llm-bridge` (no args) — MCP stdio mode (backward compatible)
- `mcp-llm-bridge serve` — HTTP mode only
- `mcp-llm-bridge --http` — MCP stdio + HTTP server on background

---

## Scenarios

### S1: Store and use an Anthropic API key

```
Given the gateway is running
When a user calls vault_store with provider="anthropic", key_name="default", api_key="sk-ant-..."
Then the key is encrypted with AES-256-GCM and stored in SQLite
And when the user calls llm_generate with prompt="Hello" and provider="anthropic"
Then the gateway decrypts the key, calls Anthropic API, and returns the response
```

### S2: Fallback from API to CLI

```
Given the vault has no anthropic credential
And the claude CLI is detected
When the user calls llm_generate with prompt="Hello"
Then the gateway falls back to the claude CLI adapter
And returns the CLI response
```

### S3: Model-based routing

```
Given the vault has both anthropic and openai credentials
When the user calls llm_generate with model="gpt-4o"
Then the gateway routes to the openai adapter
```

### S4: HTTP API generate

```
Given the gateway HTTP server is running on port 3456
And an anthropic credential is stored
When POST /v1/generate with {"prompt": "Hello", "provider": "anthropic"}
Then returns 200 with {"text": "...", "provider": "anthropic", "model": "..."}
```

### S5: Credential listing (masked)

```
Given credentials for anthropic and openai are stored
When the user calls vault_list (or GET /v1/credentials)
Then returns [
  { id: 1, provider: "anthropic", key_name: "default", value: "sk-ant-...***" },
  { id: 2, provider: "openai", key_name: "default", value: "sk-...***" }
]
```

### S6: Backward compatibility

```
Given the existing MCP config points to mcp-llm-bridge
When Claude Code calls llm_generate with { prompt: "Hello" }
Then the behavior is identical to the current JS version
```

---

## Acceptance Criteria

### Must Pass (Phase 1 gate)

- [ ] All source files are TypeScript with strict mode, project compiles cleanly
- [ ] Credential vault encrypts/decrypts API keys correctly (test with roundtrip)
- [ ] `vault_store`, `vault_list`, `vault_delete` MCP tools work
- [ ] Anthropic adapter generates text using stored credentials
- [ ] OpenAI adapter generates text using stored credentials
- [ ] CLI adapters still work as fallback (claude, gemini, codex, copilot)
- [ ] `llm_generate` accepts optional `model` parameter
- [ ] HTTP server starts on configured port
- [ ] `POST /v1/generate` returns LLM response
- [ ] `GET /v1/credentials` returns masked credential list
- [ ] MCP stdio transport works (backward compatible with existing Claude Code config)
- [ ] Tests exist for: vault roundtrip, adapter interface, router logic

### Nice-to-Have (Phase 1)

- [ ] `POST /v1/credentials/:id/test` — test if a credential works
- [ ] `llm_models` tool lists all available models
- [ ] Graceful error messages when no credentials and no CLI available
