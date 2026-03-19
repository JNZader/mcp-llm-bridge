# Tasks: LLM Gateway — Phase 1

**Change**: `llm-gateway`
**Date**: 2026-03-19
**Derived from**: `design.md`

---

## Task Overview

8 atomic tasks, each independently committable. Estimated total: ~2-3 hours.

---

## Task 1: TypeScript Setup + Migration

**Goal**: Convert project to TypeScript, keep everything working.

### Steps
1. Add `tsconfig.json` with strict mode, ESNext module, NodeNext resolution
2. Add dev dependencies: `typescript`, `tsx`, `@types/node`
3. Rename `src/index.js` → `src/index.ts`, `src/detect.js` → `src/detect.ts`, `src/generate.js` → `src/generate.ts`
4. Add type annotations to all functions (no `any` escapes)
5. Update `package.json`: scripts use `tsx`, main points to `src/index.ts`
6. Delete `src/detect.test.js` (will be rewritten in Task 7)
7. Verify: `npx tsx src/index.ts` starts without errors

### Files
- `tsconfig.json` (new)
- `src/index.ts` (renamed + typed)
- `src/detect.ts` (renamed + typed)
- `src/generate.ts` (renamed + typed)
- `package.json` (updated scripts + devDeps)

### Commit
`feat: migrate codebase to TypeScript strict mode`

---

## Task 2: Core Types + Config

**Goal**: Define shared interfaces and configuration loading.

### Steps
1. Create `src/core/types.ts` — `LLMProvider`, `GenerateRequest`, `GenerateResponse`, `StoredCredential`, `MaskedCredential`, `GatewayConfig`, `ModelInfo`
2. Create `src/core/config.ts` — `loadConfig()` reads env vars with defaults:
   - `LLM_GATEWAY_MASTER_KEY` → hex string or auto-generate
   - `LLM_GATEWAY_DB_PATH` → `~/.llm-gateway/vault.db`
   - `LLM_GATEWAY_PORT` → `3456`
3. Master key auto-generation: if no env var and no `~/.llm-gateway/master.key` file, generate 32 random bytes, save with mode `0o600`
4. Create `.env.example` with documented env vars

### Files
- `src/core/types.ts` (new)
- `src/core/config.ts` (new)
- `.env.example` (new)

### Commit
`feat: add core types and configuration module`

---

## Task 3: Credential Vault

**Goal**: Encrypted SQLite credential storage.

### Steps
1. Add dependency: `better-sqlite3`, `@types/better-sqlite3`
2. Create `src/vault/crypto.ts` — `encrypt(plaintext, key)` and `decrypt(data, key)` using AES-256-GCM
3. Create `src/vault/schema.ts` — `initializeDb(db)` creates `credentials` table
4. Create `src/vault/vault.ts` — `Vault` class with:
   - `constructor(config: GatewayConfig)` — opens DB, initializes schema
   - `store(provider, keyName, apiKey)` → upserts encrypted credential
   - `getDecrypted(provider, keyName?)` → returns decrypted API key
   - `has(provider, keyName?)` → boolean check
   - `listMasked()` → returns credentials with masked values
   - `delete(id)` → removes credential
   - `mask(value)` → shows first 7 chars + `...***`

### Files
- `src/vault/crypto.ts` (new)
- `src/vault/schema.ts` (new)
- `src/vault/vault.ts` (new)
- `package.json` (add better-sqlite3)

### Commit
`feat: add encrypted credential vault with AES-256-GCM`

---

## Task 4: Provider Adapters

**Goal**: Implement Anthropic + OpenAI API adapters, refactor CLI adapters.

### Steps
1. Add dependencies: `@anthropic-ai/sdk`, `openai`
2. Create `src/adapters/anthropic.ts` — `AnthropicAdapter` implements `LLMProvider`
3. Create `src/adapters/openai.ts` — `OpenAIAdapter` implements `LLMProvider`
4. Extract CLI adapters from `src/generate.ts` into individual files:
   - `src/adapters/cli-claude.ts`
   - `src/adapters/cli-gemini.ts`
   - `src/adapters/cli-codex.ts`
   - `src/adapters/cli-copilot.ts`
5. Each CLI adapter implements `LLMProvider` with `isAvailable()` using detection logic
6. Create `src/adapters/index.ts` — exports all adapters, `createAllAdapters(vault)` factory
7. Delete old `src/generate.ts` and `src/detect.ts` (logic absorbed into adapters)

### Files
- `src/adapters/anthropic.ts` (new)
- `src/adapters/openai.ts` (new)
- `src/adapters/cli-claude.ts` (new)
- `src/adapters/cli-gemini.ts` (new)
- `src/adapters/cli-codex.ts` (new)
- `src/adapters/cli-copilot.ts` (new)
- `src/adapters/index.ts` (new)
- `src/generate.ts` (delete)
- `src/detect.ts` (delete)
- `package.json` (add SDKs)

### Commit
`feat: add Anthropic + OpenAI API adapters, refactor CLI adapters`

---

## Task 5: Provider Router

**Goal**: Request routing with provider selection and fallback.

### Steps
1. Create `src/core/router.ts` — `Router` class with:
   - `register(provider)` — adds to registry
   - `generate(request)` — resolves candidates, tries in order with fallback
   - `resolveCandidates(request)` — model match → provider match → API-first ordering
   - `getAvailableModels()` — aggregates models from available providers
   - `getProviderStatuses()` — returns `{ id, name, type, available }` for each
2. Provider priority: explicit provider/model > API adapters > CLI adapters

### Files
- `src/core/router.ts` (new)

### Commit
`feat: add provider router with model selection and fallback`

---

## Task 6: MCP Server (Expanded Tools)

**Goal**: Rewrite MCP server with new tools, backward-compatible `llm_generate`.

### Steps
1. Create `src/server/mcp.ts` — `startMcpServer(router, vault)` function
2. Register tools:
   - `llm_generate` — same required `prompt`, add optional `model`, `maxTokens`. Uses router.
   - `vault_store` — `{ provider: string, keyName?: string, apiKey: string }`
   - `vault_list` — no params, returns masked credentials
   - `vault_delete` — `{ id: number }`
   - `llm_models` — no params, returns available models
3. `llm_generate` response format must be backward compatible: return `{ text, provider, model, tokensUsed }`
4. Error handling: each tool returns clear error messages in MCP content

### Files
- `src/server/mcp.ts` (new)

### Commit
`feat: expand MCP server with vault and model tools`

---

## Task 7: HTTP Server (Hono)

**Goal**: Add HTTP transport with /v1/ API endpoints.

### Steps
1. Add dependencies: `hono`, `@hono/node-server`
2. Create `src/server/http.ts` — `startHttpServer(router, vault, config)` function
3. Endpoints:
   - `POST /v1/generate` — body: `GenerateRequest`, returns `GenerateResponse`
   - `GET /v1/models` — returns `{ models: ModelInfo[] }`
   - `GET /v1/providers` — returns provider statuses
   - `POST /v1/credentials` — body: `{ provider, keyName?, apiKey }`, returns `{ id }`
   - `GET /v1/credentials` — returns `{ credentials: MaskedCredential[] }`
   - `DELETE /v1/credentials/:id` — returns `{ ok: true }`
4. Add error handling middleware: catch errors → `{ error: string, code: string }`
5. Add `GET /health` — returns `{ status: "ok", version }` (useful for Coolify)
6. Log startup with port number

### Files
- `src/server/http.ts` (new)
- `package.json` (add hono deps)

### Commit
`feat: add Hono HTTP server with /v1/ API endpoints`

---

## Task 8: Entrypoint + Tests

**Goal**: Wire everything together, add tests, verify it all works.

### Steps
1. Rewrite `src/index.ts`:
   - Parse mode from `process.argv[2]` (undefined → MCP, `serve` → HTTP, `--http` → both)
   - Initialize config, vault, router
   - Register all adapters via `createAllAdapters(vault)`
   - Start appropriate transports
2. Update `package.json`:
   - `"start"`: `"tsx src/index.ts"`
   - `"dev"`: `"tsx watch src/index.ts"`
   - `"serve"`: `"tsx src/index.ts serve"`
   - `"test"`: `"tsx --test test/*.test.ts"`
   - `"build"`: `"tsup src/index.ts --format esm --dts"`
3. Create tests:
   - `test/vault.test.ts` — encrypt/decrypt roundtrip, store/get/list/delete, mask function
   - `test/router.test.ts` — candidate resolution, model routing, fallback order, API-before-CLI
   - `test/adapters.test.ts` — adapter interface compliance (all adapters have required methods)
4. Add `tsup` to devDeps if not already present
5. Run full test suite, fix any issues
6. Test manually: start MCP mode, start HTTP mode, store a key, generate

### Files
- `src/index.ts` (rewrite)
- `package.json` (final updates)
- `test/vault.test.ts` (new)
- `test/router.test.ts` (new)
- `test/adapters.test.ts` (new)

### Commit
`feat: wire entrypoint, add tests, complete Phase 1`

---

## Dependency Graph

```
Task 1 (TS setup)
  └──▶ Task 2 (types + config)
         ├──▶ Task 3 (vault)
         │      └──▶ Task 4 (adapters) ← needs vault for API adapters
         │             └──▶ Task 5 (router) ← needs adapters
         │                    ├──▶ Task 6 (MCP server)
         │                    └──▶ Task 7 (HTTP server)
         │                           └──▶ Task 8 (entrypoint + tests) ← wires everything
         └──────────────────────────────────────────┘
```

Tasks 6 and 7 can be done in parallel (both depend on router + vault, independent of each other).

---

## Quick Reference

| # | Task | Est. | Key Output |
|---|------|------|------------|
| 1 | TypeScript migration | 15m | All `.ts`, compiles |
| 2 | Core types + config | 10m | `types.ts`, `config.ts` |
| 3 | Credential vault | 20m | `vault.ts`, AES-256-GCM |
| 4 | Provider adapters | 25m | 6 adapters (2 API + 4 CLI) |
| 5 | Router | 15m | Selection + fallback |
| 6 | MCP server | 15m | 5 tools |
| 7 | HTTP server | 15m | 6 endpoints |
| 8 | Entrypoint + tests | 20m | Wiring + 3 test files |
| | **Total** | **~2.5h** | |
