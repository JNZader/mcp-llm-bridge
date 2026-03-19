# Proposal: LLM Gateway

**Change**: `llm-gateway`
**Status**: Draft
**Date**: 2026-03-19
**Author**: Javier

---

## Intent

Evolve `mcp-llm-bridge` from a CLI-only MCP tool into a **centralized LLM credential management and routing service** that all projects (ghagga, md-evals, repoforge, future projects) consume through a single interface.

Today, every project reinvents credential management:
- ghagga stores per-installation encrypted API keys in its DB, and built a CLI bridge with subprocess env injection
- md-evals and repoforge likely use hardcoded env vars
- OpenCode OAuth tokens (`auth.json`) can't be injected via env vars
- CLI tools are fragile in containers — different auth mechanisms, timeouts, no JSON output

The goal is: **one service manages all LLM credentials and routing, every project just calls it.**

## Problem

### What keeps breaking

1. **Scattered credentials** — API keys live in env vars, `.env` files, database rows, and auth.json files across 3+ projects
2. **OpenCode OAuth can't be injected** — `opencode/*` models require Google OAuth tokens stored in `auth.json`, not passable via env var
3. **CLI tools are unreliable in containers** — subprocess execution is slow, fragile, and hard to debug in Coolify deployments
4. **No model selection** — each project hardcodes which model to use or has no way to choose
5. **Duplicated fallback logic** — every project implements its own "try provider A, fall back to B" chain
6. **No multi-user support** — the current bridge assumes a single user's CLI installations

### What the user has learned today

- Direct API calls (anthropic SDK, openai SDK) with env-injected keys work perfectly
- OpenCode free models need OAuth auth — the `auth.json` contains all tokens
- CLI tools (claude, gemini, codex, copilot) are useful locally but not in containers
- The ghagga CLI bridge approach (subprocess with env vars) works but is fragile

## Scope

### In scope

1. **Credential vault** — encrypted storage for API keys, OAuth tokens, and auth.json blobs, per-user
2. **Provider registry** — configuration of available providers (anthropic, openai, groq, openrouter, opencode) with their models and auth requirements
3. **LLM routing** — request routing with provider preference, model selection, and automatic fallback
4. **Dual transport** — MCP server (stdio) for Claude Code + HTTP API for server-side projects
5. **Direct API providers** — anthropic, openai, groq, openrouter via their official SDKs
6. **CLI providers** — keep existing claude/gemini/codex/copilot CLI adapters as fallback
7. **Basic admin UI** — credential CRUD (add/edit/delete API keys), provider status, test connection

### Out of scope (future)

- Usage tracking / billing
- Rate limiting / quotas
- Streaming responses (v1 is request/response)
- Multi-tenant org-level credentials
- Prompt caching / response caching
- Load balancing across multiple keys for same provider

## Approach

### Architecture: Modular monolith with dual transport

```
┌─────────────────────────────────────────────────────┐
│                   LLM Gateway                        │
│                                                      │
│  ┌──────────┐  ┌──────────┐                         │
│  │ MCP      │  │ HTTP     │   ← Transports          │
│  │ (stdio)  │  │ (Hono)   │                         │
│  └────┬─────┘  └────┬─────┘                         │
│       │              │                               │
│       └──────┬───────┘                               │
│              │                                       │
│       ┌──────▼──────┐                                │
│       │   Router    │   ← Provider selection,        │
│       │             │     model mapping, fallback    │
│       └──────┬──────┘                                │
│              │                                       │
│   ┌──────────┼──────────┐                            │
│   │          │          │                            │
│   ▼          ▼          ▼                            │
│ ┌──────┐ ┌──────┐ ┌──────┐                          │
│ │ API  │ │ API  │ │ CLI  │  ← Provider adapters     │
│ │ anthr│ │ openai│ │ adapt│                          │
│ └──┬───┘ └──┬───┘ └──┬───┘                          │
│    │        │        │                               │
│    └────────┼────────┘                               │
│             │                                        │
│      ┌──────▼──────┐                                 │
│      │  Credential │   ← Encrypted SQLite vault     │
│      │   Vault     │                                 │
│      └─────────────┘                                 │
└──────────────────────────────────────────────────────┘
```

### Key decisions

1. **SQLite for credential storage** — encrypted at rest with `better-sqlite3` + AES-256-GCM. No external DB dependency. Single file, easy backup.

2. **Hono for HTTP** — lightweight, fast, TypeScript-native. Runs on Node.js. Avoids Express bloat.

3. **Keep MCP transport** — Claude Code and other MCP clients connect via stdio, same as today. The MCP tool set expands.

4. **Direct SDK calls over CLI** — prioritize `@anthropic-ai/sdk`, `openai`, etc. over subprocess execution. CLI adapters remain as fallback for providers that don't have API access.

5. **Provider adapters as plugins** — each provider (anthropic, openai, groq, openrouter, opencode-cli) is a self-contained adapter. Adding a new provider = adding one file.

6. **Single-user first, multi-user later** — v1 uses a master encryption key (from env var or generated on first run). Multi-user auth comes later.

7. **Migration from current codebase** — convert existing JS files to TypeScript, restructure into modules, keep existing CLI adapters working.

### Tech stack

| Component | Choice | Why |
|-----------|--------|-----|
| Language | TypeScript (strict) | User preference, existing codebase is JS |
| Runtime | Node.js 22+ | Already in use |
| HTTP | Hono | Lightweight, TS-native, fast |
| MCP | @modelcontextprotocol/sdk | Already in use |
| Credential store | better-sqlite3 + crypto | No external deps, encrypted |
| API SDKs | @anthropic-ai/sdk, openai | Official, maintained |
| Build | tsx (dev), tsup (build) | Simple, fast |
| Admin UI | Static HTML + htmx | No build step, ship fast |

### Provider adapter interface

```typescript
interface LLMProvider {
  id: string;                          // "anthropic", "openai", "groq", etc.
  name: string;                        // Display name
  type: "api" | "cli";                 // Direct API or CLI subprocess
  models: ModelInfo[];                 // Available models
  requiresCredentials: CredentialType[];

  generate(request: GenerateRequest, credentials: ResolvedCredentials): Promise<GenerateResponse>;
  testConnection(credentials: ResolvedCredentials): Promise<boolean>;
}
```

### MCP tools (expanded from current single tool)

| Tool | Purpose |
|------|---------|
| `llm_generate` | Generate text (backward compatible) |
| `llm_models` | List available models/providers |
| `llm_credential_add` | Store a new credential |
| `llm_credential_list` | List stored credentials (masked) |
| `llm_credential_test` | Test if a credential works |
| `llm_provider_status` | Check which providers are available |

### HTTP API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/generate` | Generate text |
| GET | `/api/models` | List models |
| GET | `/api/providers` | Provider status |
| POST | `/api/credentials` | Add credential |
| GET | `/api/credentials` | List credentials (masked) |
| DELETE | `/api/credentials/:id` | Remove credential |
| POST | `/api/credentials/:id/test` | Test credential |
| GET | `/ui/*` | Admin dashboard |

### Phased delivery

**Phase 1: Core gateway (tonight)**
- TypeScript migration of existing code
- Credential vault (SQLite + encryption)
- Anthropic + OpenAI API adapters
- HTTP API (Hono)
- Keep MCP stdio transport working
- Basic `llm_generate` via both transports

**Phase 2: Full provider coverage (next session)**
- Groq, OpenRouter adapters
- OpenCode OAuth adapter (auth.json parsing)
- Model selection in generate requests
- Provider fallback chain configuration

**Phase 3: Admin UI + multi-project (future)**
- htmx admin dashboard
- Credential management UI
- Per-project credential scoping
- Integration with ghagga dashboard

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Scope creep — trying to build too much tonight | High | High | Phase 1 is strictly: vault + 2 API adapters + HTTP + MCP. No UI. |
| Encryption complexity | Medium | Medium | Use Node.js built-in `crypto` with AES-256-GCM. Well-documented pattern. |
| Breaking existing MCP clients | Low | High | Keep `llm_generate` tool with same interface. New tools are additive. |
| CLI adapters flaky in containers | Known | Medium | CLI adapters are fallback only. API adapters are primary. |
| SQLite file permissions in Docker | Medium | Low | Standard volume mount. Document in deployment notes. |

## Acceptance Criteria

### Phase 1 (MVP — tonight's target)

1. **Credential vault works** — can store and retrieve encrypted API keys via CLI or API
2. **Anthropic adapter works** — `POST /api/generate` with `provider: "anthropic"` calls Anthropic API with stored credentials
3. **OpenAI adapter works** — same for OpenAI-compatible providers
4. **MCP transport works** — `llm_generate` tool still works via stdio for Claude Code
5. **HTTP transport works** — Hono server accepts requests on configurable port
6. **Backward compatible** — existing `llm_generate` MCP tool works with no client changes
7. **Can deploy on Coolify** — Dockerfile works, single env var for master encryption key

### Phase 2

8. **Groq + OpenRouter adapters** — work with stored API keys
9. **Model selection** — can specify model in generate request (e.g. `model: "claude-sonnet-4-20250514"`)
10. **Fallback chain** — configurable provider fallback order

### Phase 3

11. **Admin UI** — can manage credentials from browser
12. **ghagga integration** — ghagga worker calls this instead of its own CLI bridge

## How This Replaces Current Patterns

| Project | Current approach | After LLM Gateway |
|---------|-----------------|-------------------|
| **ghagga** | Per-installation encrypted keys in DB, CLI bridge subprocess | Calls `POST /api/generate` — gateway handles credentials and routing |
| **md-evals** | Env vars with hardcoded keys | Calls `POST /api/generate` — no keys in env |
| **repoforge** | Env vars with hardcoded keys | Same |
| **Claude Code** | Direct MCP tool (current) | Same MCP tool, now backed by credential vault + API adapters |

## Decision Required

Approve this proposal to proceed to spec + design + tasks for Phase 1?

Phase 1 is scoped to be achievable in one focused session: TypeScript migration, credential vault, 2 API adapters, dual transport.
