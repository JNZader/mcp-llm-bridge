# ARCHITECTURE

Short architectural map of `mcp-llm-bridge` after the major wiring / refactor wave.

## Purpose

`mcp-llm-bridge` is a gateway that exposes:
- an HTTP API (`/v1/*`)
- an MCP server (stdio)

It routes LLM traffic across providers, applies policy/security, and exposes supporting capabilities like code search, analytics, logging, sync operations, and conversation pagination.

---

## Main Composition Roots

### `src/index.ts`
Application bootstrap.

Responsibilities:
- load config
- initialize DB / vault
- create Router
- create shared runtime services (analytics, request logger, session manager, etc.)
- start HTTP server and/or MCP server

### `src/server/http.ts`
HTTP composition root.

Responsibilities:
- normalize `StartHttpServerDeps`
- register middleware (auth, CORS, rate limiting, timeouts, correlation IDs, security profile)
- compose route modules
- start Hono server

### `src/server/mcp.ts`
MCP façade.

Responsibilities:
- public exports / compatibility surface
- outer `handleToolCall()` wrapper with compression
- delegate bootstrap to `mcp-server.ts`
- delegate dispatch to `mcp-dispatcher.ts`

---

## HTTP Route Modules

Located under `src/server/routes/`.

- `public.ts` — `/`, `/health`, GitHub auth shell routes
- `observability.ts` — logs, analytics, metrics, compression stats
- `tooling.ts` — tool catalog, local model status, balancer strategies
- `comparison.ts` — compare + compare history
- `storage.ts` — credentials/files CRUD
- `metadata.ts` — models/providers/latency/cost lookups
- `execution.ts` — `/v1/generate` and `/v1/chat/completions`
- `groups.ts` — group endpoints
- `usage.ts` — usage/cost endpoints
- `circuit-breaker.ts` — circuit-breaker endpoints
- `approvals.ts` — approval endpoints

Admin route modules live under `src/server/routes/admin/`.

- `shell.ts`
- `dashboard.ts`
- `security-profiles.ts`
- `api-keys.ts`
- `sync.ts`
- `discovery.ts`
- `operations.ts`

### Dashboard surfaces

- `src/server/dashboard.ts` — legacy inline local ops shell served at `GET /`
- `dashboard/` — separate React admin/observability app, built into `docs/`

These two surfaces intentionally coexist for now and do not have full feature parity.

---

## Core Runtime Modules

### `src/core/router.ts`
Main routing façade for provider selection and request execution.

Still one of the main backend hotspots.

It coordinates:
- provider candidate resolution
- group routing
- model routing
- local LLM offload
- fallback behavior
- circuit breaker interaction
- analytics hooks

### `src/session/session-manager.ts`
Single in-memory session runtime.

Supports two explicit session kinds:
- `router-sticky`
- `api-group`

Used for:
- router sticky affinity
- group/session dashboard metrics

### `src/security/*`
Security profiles, enforcer, sanitization, route/tool categories.

### `src/logging/*`
SQLite-backed request logging.

### `src/analytics/*`
In-memory aggregation of request metrics with HTTP exposure.

---

## MCP Runtime Structure

### `src/server/mcp-tool-registry.ts`
Static MCP tool registry + runtime tool assembly.

### `src/server/mcp-server.ts`
MCP server bootstrap:
- stdio startup
- security wrapping
- dynamic plugin loading

### `src/server/mcp-dispatcher.ts`
Dispatch orchestration:
- approval gate
- built-in dispatch
- dynamic tool fallback
- error normalization

### `src/server/mcp-tool-handlers.ts`
Non-LLM tool handlers:
- vault
- approvals
- usage
- code search
- pageindex
- shared state
- groups
- circuit breaker

### `src/server/mcp-llm-handlers.ts`
LLM-specific handlers:
- `llm_generate`
- `local_llm_generate`
- `discover_models`

### `src/mcp-builder/*`
Dynamic MCP builder/plugin infrastructure.

---

## Search / Retrieval Stack

### `src/code-search/*`
Code search runtime.

Supports:
- keyword search
- BM25 (`minisearch`)
- vector search (`@xenova/transformers` embeddings)
- hybrid RRF fusion

### `src/pageindex/*`
Conversation pagination and retrieval for MCP tools.

---

## Sync / Catalog / Admin Support

### `src/model-sync/*`
Model synchronization from upstream providers.

### `src/price-sync/*`
Pricing synchronization from upstream providers.

### `src/tool-catalog/*`
HTTP tool catalog/search backed by the runtime MCP registry.

---

## Experimental / Not Fully Wired

- `src/acp/*` — ACP protocol island, not part of active runtime. It is a tested protocol prototype, but there is currently no bootstrap path from `src/index.ts`, no active ACP transport surface, and no live integration with the MCP/HTTP execution runtime.
- `src/sandbox/*` — prepared sandbox infrastructure exists, but it is not fully wired into the active runtime; sandboxed execution tools are not exposed yet

---

## Current Main Hotspots

If you continue refactoring, the highest-value hotspots are:

1. `src/core/router.ts`
2. `src/server/routes/execution.ts`
3. MCP tool definition/dispatch unification

Everything else is in a much healthier state than before this cleanup wave.
