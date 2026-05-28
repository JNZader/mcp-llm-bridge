# Deep Investigation Report — Four Pending Features for mcp-llm-bridge

> **Repo:** `github.com/JNZader/mcp-llm-bridge` (v0.5.1 Beta, package.json confirmed)  
> **Gateway:** `gateway.javierzader.com`  
> **Date:** 2026-05-27  
> **Investigator:** Senior Architect  
> **Completed Features:** MB-1 (cross-model bridging), MB-2 (context compression), MB-3 (CRDT state merging), MB-4 (semantic code search)  
> **Partial Implementations:** Security profiles, approval flows, Docker sandbox, ACP protocol, MCP builder, three-part prompt, RTK compression, hybrid RRF, local-LLM, model-routing, model-discovery  

---

## Executive Summary

**The "dead code" pattern discovered in prior investigations continues.** Of the four features analyzed here, **one already has a skeletal module** (`src/tool-catalog/index.ts`), while the other three are **completely absent** from the codebase. This is a different ratio than the previous batches (where most features were partially coded but unwired), which raises the stakes: three of these four are genuine green-field builds.

| Feature | Source Project | Stars | Local Status | Effort Real |
|---------|----------------|-------|--------------|-------------|
| **MB-6: JSONL streaming via fsnotify** | phiat/claude-esp | 146 | ❌ Not implemented | **L (~60h)** |
| **MB-8: Multi-backend storage + migration** | memory-graph/memory-graph | 205 | ❌ Not implemented | **XL (~120h)** |
| **Batch 5 #1: Unified tool catalog** | RhysSullivan/executor | 1.8k | ⚠️ Skeleton exists (`src/tool-catalog/`) | **L (~70h)** |
| **Batch 6 #1: Visual workflow builder** | simstudioai/sim | 28.6k | ❌ Not implemented | **XL (~150h)** |

**Critical architectural tension:** Two of these features (unified tool catalog + visual workflow builder) have **synergistic overlap**. The workflow builder needs a catalog of nodes to drag onto the canvas; the tool catalog needs an execution engine to run composed workflows. If built independently, they will require a painful retrofit. If planned together, they can share a node/executor abstraction.

**Recommendation:** Do NOT build the visual workflow builder before the unified tool catalog is solid. A workflow canvas without a rich tool catalog is a toy. A tool catalog without a workflow engine is still independently useful.

---

## Feature 1: MB-6 — JSONL Streaming via fsnotify

### Source Project: `phiat/claude-esp` (v0.8.0, Go, MIT)

**What it does:** Streams Claude Code's hidden output (thinking blocks, tool calls, subagents, background tasks) from JSONL session logs to a separate TUI in real-time using OS-native filesystem notifications (`fsnotify` → inotify/kqueue/FSEvents).

**Key architectural insights from source code inspection:**
- **Watcher:** Dual-mode (fsnotify preferred, polling fallback). Debounces writes at 50ms. Handles directory creation races by scanning new directories recursively. Tracks file read positions per-session.
- **Parser:** Sophisticated JSONL line parser with 12 `StreamItemType`s (thinking, tool_input, tool_output, text, turn_marker, compact_marker, hook_output, diagnostics, pr_link, cache_miss, session_event, session_title). Gracefully skips malformed/truncated lines (base64 images can exceed 10MB scanner buffer).
- **Session model:** Hierarchical tree (Main → Subagents → Background Tasks). Correlates tool IDs across input/output. Reads `.meta.json` for agent types.

---

### A) Technical Architecture

#### Where it fits in mcp-llm-bridge

The bridge currently has **no real-time log streaming**. It has:
- `src/logging/` — basic request logging types and `RequestLogger` class (unwired from inspection)
- `src/session/session-manager.ts` — `SessionManager` (in-memory TTL-based session affinity)
- `src/server/http.ts` — SSE streaming for chat completions only
- `dashboard/` — React+Vite admin dashboard (no live log view)

JSONL streaming adds a **live observability plane** that is orthogonal to the request/response gateway:

```
┌─────────────────────────────────────────────────────────────┐
│                      mcp-llm-bridge                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ MCP stdio   │  │ HTTP API    │  │ JSONL Stream Server │  │
│  │ (existing)  │  │ (existing)  │  │    (NEW)            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                │                    │                │
│         └────────────────┴────────────────────┤            │
│                                                 ▼            │
│                              ┌─────────────────────────┐   │
│                              │   Event Bus / PubSub    │   │
│                              │   (SSE + WebSocket)      │   │
│                              └─────────────────────────┘   │
│                                         │                  │
│                      ┌──────────────────┼──────────────────┐ │
│                      ▼                  ▼                  ▼ │
│                 Dashboard        External Consumers     Log  │
│                 (live tail)      (biogas, ghagga)       Sink │
└─────────────────────────────────────────────────────────────┘
```

#### New modules needed

| Module | Purpose | Files |
|--------|---------|-------|
| `src/streaming/` | Core JSONL streaming engine | `src/streaming/watcher.ts`, `src/streaming/parser.ts`, `src/streaming/types.ts` |
| `src/streaming/backends/` | Pluggable log source backends | `src/streaming/backends/fsnotify.ts`, `src/streaming/backends/polling.ts`, `src/streaming/backends/stdio.ts` |
| `src/server/sse-stream.ts` | HTTP SSE endpoint for live log streaming | `src/server/sse-stream.ts` |
| `src/logging/consumer.ts` | Bridge's own log consumer (writes gateway events to JSONL) | `src/logging/consumer.ts` |
| `dashboard/src/logs/` | Live log viewer panel | `dashboard/src/logs/LogStream.tsx`, `dashboard/src/logs/LogViewer.tsx` |

#### Interaction with existing features

| Feature | Interaction | Impact |
|---------|-------------|--------|
| **MB-2 (Compression)** | Streamed JSONL logs are raw. If logs are large, the SSE stream could apply RTK-style line filtering before transmission. | Synergy |
| **MB-3 (CRDT)** | Multi-agent collaboration produces distributed logs. CRDT can merge log streams from multiple bridge instances into a unified view. | High synergy |
| **Cost Tracker** | Every log line carries token usage. The stream can feed real-time cost dashboards. | Synergy |
| **Security Profiles** | Streamed logs may contain tool outputs with sensitive data. Security profiles should redact vault credentials from streamed logs. | Required |
| **Approval Flows** | Approval requests/rejections should appear in the live stream as `session_event` items. | Required |

---

### B) Implementation Complexity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Implement `LogWatcher` with chokidar/fs.watch backend + polling fallback | `src/streaming/watcher.ts` | 10h |
| 2 | Implement `JsonlParser` with StreamItem types, graceful truncation handling | `src/streaming/parser.ts` | 12h |
| 3 | Implement session tree builder (Main → Subagents → Background Tasks) | `src/streaming/session-tree.ts` | 8h |
| 4 | Build SSE streaming endpoint (`/v1/stream/logs`) with session filtering | `src/server/sse-stream.ts` | 8h |
| 5 | Build dashboard live log viewer (React, virtualized list, filter toggle) | `dashboard/src/logs/*` | 12h |
| 6 | Integrate with bridge's own `RequestLogger` to emit gateway events as JSONL | `src/logging/consumer.ts` | 6h |
| 7 | Add MCP tools: `stream_subscribe`, `stream_list_sessions` | `src/server/mcp.ts` | 4h |
| 8 | Unit + integration tests (file watcher, parser, SSE client) | `test/streaming/*.test.ts` | 12h |

**Total estimate:** ~72 hours (roughly 1.5–2 developer-weeks).  
**Effort classification:** **L** (not XL because the reference implementation is small: ~1,200 LOC of Go, which maps to ~2,000–2,500 LOC of TypeScript).

#### Technical dependencies

- `chokidar` (npm) — cross-platform fsnotify wrapper, battle-tested, used by Vite/Webpack. Alternative: native `fs.watch` (Linux only, buggy on macOS).
- `better-sqlite3` (already in deps) — for persisting stream positions across restarts.
- No new major frameworks needed.

---

### C) Standards & Maturity Analysis

| Signal | Assessment |
|--------|------------|
| **Stars / Forks** | 146 / 7 — small but focused community |
| **Releases** | 21 releases, v0.8.0 (May 23 2026) — actively maintained |
| **Pre-built binaries** | Linux (amd64, arm64), macOS (amd64, arm64), Windows (amd64) — mature distribution |
| **Test coverage** | `tests/` directory present, Go test idioms |
| **Spec compliance** | No formal spec. The JSONL format is **Claude Code proprietary** and may change without notice. This is the biggest risk. |

**Spec gaps:**
1. **No standardized JSONL schema for LLM session logs.** Claude Code's JSONL is undocumented. claude-esp reverse-engineered it. If Anthropic changes field names, the parser breaks.
2. **No cross-platform fsnotify standard.** chokidar abstracts it, but edge cases (NFS, Docker volumes, WSL2) require polling fallback.
3. **No SSE standard for log streaming.** The bridge must invent the API shape (`/v1/stream/logs?session=&types=`).

---

### D) Integration with Consumers

| Consumer | How they would consume | Changes needed | Breaking? |
|----------|------------------------|----------------|-----------|
| **biogas** | Subscribe to SSE stream to monitor long-running LLM pipelines | Add SSE client, parse `StreamItem` JSON | No — additive |
| **ghagga** | Stream code review progress to user dashboard | Dashboard opens SSE connection to bridge | No — additive |
| **javi-ai** | Real-time visibility into subagent execution | Consume `stream_list_sessions` MCP tool | No — additive |
| **repoforge** | Stream repo indexing progress | Same as above | No — additive |

**Backwards compatibility:** 100% additive. Existing HTTP and MCP interfaces unchanged. The SSE endpoint is a new face.

---

### E) Prioritization within this domain

**Position:** 3rd of 4.  
**Why:** It is valuable for observability but not a functional requirement for any consumer. biogas, ghagga, javi-ai, and repoforge all work today without live log streaming. It becomes critical when multi-agent orchestration (MB-3 CRDT + subagents) scales up and you need to debug distributed agent behavior.

**Can be built in parallel with:** Unified tool catalog (they touch different subsystems: streaming vs. registry).

---

### F) Open Questions / Risks

#### What is unknown or speculative?

1. **JSONL format stability:** Anthropic has not documented Claude Code's JSONL schema. claude-esp's parser is based on observation. A single Claude Code update could break the parser.
2. **Bridge's own JSONL source:** Does the bridge itself produce JSONL logs today? `src/logging/request-logger.ts` exists but its format is unknown. If it doesn't emit JSONL, the streaming feature needs a new logging pipeline.
3. **Session correlation:** Claude Code sessions are identified by `~/.claude/projects/<path>/<session-id>.jsonl`. The bridge doesn't have an equivalent session file. Should the bridge write its own JSONL, or should it stream from an in-memory buffer?

#### What could derail implementation?

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Claude Code JSONL format change** | Medium | High | Decouple parser from exact field names; use optional fields with fallbacks. Monitor claude-esp repo for upstream fixes. |
| **fsnotify not working in Docker** | High (if deployed in containers) | Medium | Always implement polling fallback. Test in bridge's Docker image. |
| **File descriptor exhaustion** | Medium | Medium | Cap max watched sessions (claude-esp uses `-m` flag). Use `maxSessions` config. |
| **Logs contain PII/credentials** | High | Critical | Apply `ProfileEnforcer` redaction rules to streamed output BEFORE SSE transmission. |

#### Is this partially implemented?

**No.** `src/logging/` contains types and schemas but no fsnotify watcher, no JSONL parser, no SSE stream endpoint, and no live dashboard panel. It is a green-field build.

---

---

## Feature 2: MB-8 — Multi-Backend Storage with Migration

### Source Project: `memory-graph/memory-graph` (v0.12.4, Python, MIT)

**What it does:** Graph-based MCP memory server with **8 backend options** (SQLite, FalkorDBLite, LadybugDB, FalkorDB, Neo4j, Memgraph, Turso, Cloud) and a **5-phase migration system** (pre-flight → export → validate → import → verify) with dry-run support and rollback.

**Key architectural insights from source code inspection:**
- **Backend factory:** `BackendFactory.create_backend()` returns the appropriate adapter based on env vars. All backends implement a common interface.
- **Migration engine:** CLI command `memorygraph migrate --from sqlite --to neo4j --dry-run`. Progress reporting. Automatic cleanup on failure.
- **SQLite fallback:** When no graph backend is configured, SQLite simulates graph relationships via junction tables.
- **Cloud backend:** REST API client with circuit breaker for resilience. Multi-device sync.

---

### A) Technical Architecture

#### Where it fits in mcp-llm-bridge

The bridge today is **hard-wired to SQLite** (`better-sqlite3`). Every persistent service creates its own `Database` instance or shares the vault DB path:

```
src/index.ts (line 53)     → loadConfig() → dbPath = SQLite file
src/index.ts (line 54)     → new Vault(config) → better-sqlite3
src/index.ts (line 63)     → new CostTracker({ dbPath }) → better-sqlite3
src/index.ts (line 70)     → new GroupStore(config.dbPath) → better-sqlite3
src/db/migrate.ts          → MigrationRunner → SQLite only
```

Multi-backend storage introduces an **abstraction layer** between the business logic and the database:

```
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                        │
│   Vault │ CostTracker │ GroupStore │ ComparisonStore │ ...   │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌───────────────┐   ┌───────────────┐
            │  Storage API  │   │  Migration   │
            │  (unified CRUD│   │  Engine      │
            │   + query)    │   │              │
            └───────┬───────┘   └──────────────┘
                    │
        ┌───────────┼───────────┬───────────┐
        ▼           ▼           ▼           ▼
    ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
    │SQLite │  │Postgres│  │Redis │  │ Turso │
    │(default│  │(prod) │  │(cache)│  │(edge) │
    └───────┘  └───────┘  └───────┘  └───────┘
```

#### New modules needed

| Module | Purpose | Files |
|--------|---------|-------|
| `src/storage/` | Storage abstraction layer | `src/storage/api.ts`, `src/storage/types.ts`, `src/storage/factory.ts` |
| `src/storage/backends/` | Backend implementations | `src/storage/backends/sqlite.ts`, `src/storage/backends/postgres.ts`, `src/storage/backends/redis.ts`, `src/storage/backends/turso.ts` |
| `src/storage/migrate.ts` | Migration engine | `src/storage/migrate.ts`, `src/storage/migrate/validator.ts`, `src/storage/migrate/exporter.ts`, `src/storage/migrate/importer.ts` |
| `src/vault/adapter.ts` | Vault refactored to use Storage API instead of direct better-sqlite3 | `src/vault/adapter.ts` |

#### Interaction with existing features

| Feature | Interaction | Impact |
|---------|-------------|--------|
| **Vault** | Currently uses `better-sqlite3` directly. Must be refactored to use Storage API. | **Breaking refactor** |
| **Cost Tracker** | Writes usage records to SQLite. Must migrate to Storage API. | **Breaking refactor** |
| **Group Store** | Same as above. | **Breaking refactor** |
| **Comparison Store** | Same as above. | **Breaking refactor** |
| **Session Store** | Currently in-memory. Could optionally persist to Redis for multi-instance deployments. | Opportunity |
| **CRDT State** | Currently in-memory. Could persist to Redis or Postgres for durability. | Opportunity |
| **Security Profiles** | DB resolver reads `security_profiles` table from SQLite. Must use Storage API. | **Breaking refactor** |

**This is a foundational, cross-cutting refactor.** It touches nearly every module that persists data.

---

### B) Implementation Complexity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Design Storage API interface (CRUD, query, transactions, migrations) | `src/storage/api.ts` | 10h |
| 2 | Implement SQLite backend (adapter over existing better-sqlite3) | `src/storage/backends/sqlite.ts` | 8h |
| 3 | Implement Postgres backend using `pg` or `postgres` driver | `src/storage/backends/postgres.ts` | 12h |
| 4 | Implement Redis backend for caching/session use cases | `src/storage/backends/redis.ts` | 10h |
| 5 | Refactor Vault to use Storage API | `src/vault/vault.ts`, `src/vault/adapter.ts` | 12h |
| 6 | Refactor CostTracker to use Storage API | `src/core/cost-tracker.ts` | 8h |
| 7 | Refactor GroupStore to use Storage API | `src/core/groups.ts` | 6h |
| 8 | Refactor ComparisonStore to use Storage API | `src/comparison/persistence.ts` | 6h |
| 9 | Build migration engine with dry-run, progress, rollback | `src/storage/migrate.ts` + submodules | 16h |
| 10 | Add migration CLI command (`mcp-llm-bridge migrate --from sqlite --to postgres`) | `src/cli/migrate.ts` | 6h |
| 11 | Schema migration abstraction (current `src/db/migrate.ts` is SQLite-only) | `src/storage/migrate/schema.ts` | 8h |
| 12 | Test matrix: SQLite → Postgres, SQLite → Redis, rollback paths | `test/storage/*.test.ts` | 20h |

**Total estimate:** ~122 hours (roughly 3 developer-weeks).  
**Effort classification:** **XL**. This is not just adding a feature — it is replumbing the foundation of the gateway.

#### Technical dependencies

- `pg` (npm) — Postgres client. Or `postgres` (denolib/postgres) for prepared statements.
- `ioredis` — Redis client with cluster support.
- `@libsql/client` — Turso/libSQL client (if Turso support is desired).
- No ORM. The bridge uses raw SQL today (`better-sqlite3`). Adding an ORM (Drizzle, Prisma) would change the entire project's character. Recommendation: keep raw SQL but abstract the driver.

---

### C) Standards & Maturity Analysis

| Signal | Assessment |
|--------|------------|
| **Stars / Forks** | 205 / 71 — growing community |
| **Releases** | 36 releases, v0.12.4 — mature release cycle |
| **PyPI packages** | `memorygraphMCP` + `memorygraphsdk` — published, versioned |
| **Test coverage** | 1,068+ tests (v0.10.0), 1,200+ in v0.11.0 |
| **Backends** | 8 options, including embedded (SQLite, FalkorDBLite), client-server (Neo4j, Memgraph), and cloud (Turso, Cloud) |
| **Multi-tenancy** | Phase 1 schema in v0.10.0+ — shows serious production thinking |

**Spec gaps:**
1. **No standard for "MCP server backend portability."** memory-graph invented its own abstraction. The bridge would need to invent a TypeScript equivalent.
2. **No standard migration format for LLM gateway state.** memory-graph uses JSON export/import. The bridge could adopt the same, but there is no interoperability guarantee with other gateways.
3. **SQLite schema differences.** The bridge's SQLite schema (vault, cost tracker, groups, comparisons, security profiles) is custom. memory-graph's schema is graph-oriented (nodes, edges, properties). The migration logic cannot be ported directly — only the **abstraction pattern** can be borrowed.

---

### D) Integration with Consumers

| Consumer | How they would consume | Changes needed | Breaking? |
|----------|------------------------|----------------|-----------|
| **biogas** | Biogas deployed at scale needs Postgres, not SQLite. Migration enables production deployment. | None — bridge admin runs migration | No |
| **ghagga** | ghagga might want Redis-backed session store for multi-instance gateway. | Config change only (`BACKEND=redis`) | No |
| **javi-ai** | javi-ai running in cloud (Kubernetes) needs Postgres or Turso for persistence. | Config change | No |
| **repoforge** | repoforge might want local SQLite for simplicity, Postgres for team sharing. | Config change | No |

**Backwards compatibility:** SQLite remains the default. Migration is opt-in. **However**, the internal refactoring (Vault, CostTracker, GroupStore, ComparisonStore) is a breaking change for the codebase itself — all tests must be updated.

---

### E) Prioritization within this domain

**Position:** 4th of 4 (last).  
**Why:** It is foundational but delivers zero user-facing value on its own. It is an enabler for production deployments. The bridge currently works fine with SQLite for all known consumers. Build this when:
- A consumer explicitly needs Postgres/Redis (multi-instance deployment)
- The SQLite DB grows beyond manageable size (> 1GB)
- Team sharing of credentials/state is required

**Can be built in parallel with:** Nothing easily. It is a serial refactor that blocks other persistence-related work until complete.

---

### F) Open Questions / Risks

#### What is unknown or speculative?

1. **Does any consumer need multi-backend today?** If all consumers run single-instance, this is premature optimization.
2. **Transaction semantics:** SQLite transactions are simple. Postgres has `SERIALIZABLE`. Redis has no ACID transactions for multi-key operations. How does the Storage API express transaction boundaries across heterogeneous backends?
3. **Schema drift:** The bridge adds new tables (e.g., `acp_sessions`, `compression_stats`) in future features. The migration engine must support incremental schema migrations for ALL backends.

#### What could derail implementation?

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Refactor breaks existing tests** | Very High | High | Run full test suite after each module refactor. Add integration tests BEFORE changing code. |
| **Postgres schema diverges from SQLite** | High | Medium | Maintain a single source of truth for schema (SQL files) with dialect-specific variants. |
| **Performance regression** | Medium | High | Benchmark Vault read/write latency before and after abstraction layer. |
| **Migration data loss** | Low | Critical | Dry-run mode mandatory. Backup SQLite file before any migration. |

#### Is this partially implemented?

**No.** `src/db/migrate.ts` is SQLite-only. There is no backend factory, no Postgres adapter, no Redis adapter, no migration CLI. The `Vault`, `CostTracker`, `GroupStore`, and `ComparisonStore` all import `better-sqlite3` directly.

---

---

## Feature 3: Batch 5 #1 — Unified Tool Catalog

### Source Project: `RhysSullivan/executor` (v1.4.33, TypeScript/Effect, MIT)

**What it does:** "The missing integration layer for AI agents." Combines OpenAPI specs, GraphQL schemas, MCP servers, and custom JS functions into a single typed tool registry with intent-based discovery. Agents can `tools.discover({ query: "github issues" })` and call any matched tool through a unified runtime.

**Key architectural insights from source code inspection:**
- **Monorepo:** `packages/*` with Effect-TS functional programming patterns.
- **Plugin system:** OpenAPI, GraphQL, MCP, Google Discovery are first-class source types. Plugin system is open to any JSON-schema-describable source.
- **Typed runtime:** Tools are callable via TypeScript with generated types: `tools.github.issues.list({ owner, repo })`.
- **Auth & policies:** Shared auth and execution policies across all tools.
- **MCP server mode:** `executor mcp` exposes the unified catalog as an MCP server.

---

### A) Technical Architecture

#### Where it fits in mcp-llm-bridge

The bridge **already has a skeleton**:

```typescript
// src/tool-catalog/index.ts (line 26)
export class ToolCatalog {
  private tools: Map<string, ToolEntry> = new Map();
  
  register(input: ToolInput, force = false): ToolEntry { ... }
  search(query: string, limit = 10): ToolEntry[] { ... }  // keyword-only
  // ...
}
```

This skeleton supports:
- 4 source types: `mcp`, `openapi`, `graphql`, `custom`
- Basic keyword search (name weight 3, tag weight 2, description weight 1)
- JSON serialization

**What it lacks:**
- No OpenAPI spec fetcher/validator
- No GraphQL introspection client
- No MCP server discovery (only the bridge's own MCP tools are registered)
- No intent-based (embedding/semantic) search — only keyword matching
- No execution runtime — it is a catalog, not an executor
- No auth policy integration

The executor integration transforms the catalog from a **static registry** into a **dynamic integration layer**:

```
┌─────────────────────────────────────────────────────────────┐
│                  Unified Tool Catalog                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ MCP Sources │  │OpenAPI Specs│  │GraphQL APIs │          │
│  │ (discover)  │  │ (fetch)     │  │(introspect) │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         └─────────────────┴─────────────────┘                │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    ▼             ▼                          │
│            ┌─────────────┐ ┌─────────────┐                     │
│            │Schema Normal│ │Intent Search│                   │
│            │(MCP↔OpenAPI↔ │(embeddings /  │                   │
│            │ GraphQL)     │ keyword hybrid)│                   │
│            └──────┬──────┘ └──────┬──────┘                   │
│                   └───────────────┘                          │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    ▼             ▼                            │
│            ┌─────────────┐ ┌─────────────┐                   │
│            │  Execution  │ │  Auth &     │                   │
│            │  Runtime    │ │  Policy     │                   │
│            │  (bridge)   │ │  (vault)    │                   │
│            └─────────────┘ └─────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

#### New modules needed

| Module | Purpose | Files |
|--------|---------|-------|
| `src/tool-catalog/fetchers/` | Source fetchers | `src/tool-catalog/fetchers/openapi.ts`, `src/tool-catalog/fetchers/graphql.ts`, `src/tool-catalog/fetchers/mcp-discovery.ts` |
| `src/tool-catalog/normalizers/` | Schema normalization | `src/tool-catalog/normalizers/to-mcp.ts` (OpenAPI→MCP, GraphQL→MCP) |
| `src/tool-catalog/search/` | Intent search | `src/tool-catalog/search/keyword.ts` (exists), `src/tool-catalog/search/semantic.ts` (embeddings) |
| `src/tool-catalog/executor/` | Execution runtime | `src/tool-catalog/executor/http.ts`, `src/tool-catalog/executor/graphql.ts`, `src/tool-catalog/executor/mcp-proxy.ts` |
| `src/tool-catalog/policies/` | Security policies | `src/tool-catalog/policies/auth.ts`, `src/tool-catalog/policies/rate-limit.ts` |

#### Interaction with existing features

| Feature | Interaction | Impact |
|---------|-------------|--------|
| **MB-1 (Bridge)** | Bridge orchestrator can route tool calls through the catalog executor instead of direct HTTP/MCP. | Synergy |
| **MB-4 (Code Search)** | The catalog can register `code_search` as a tool, making it discoverable by intent. | Synergy |
| **Security Profiles** | Every external tool must be categorized (`read`, `destructive`, etc.). The catalog should auto-tag OpenAPI methods by HTTP verb (GET=read, POST/DELETE=destructive). | Required |
| **Approval Flows** | Destructive external tools should trigger approval flows. | Required |
| **Vault** | OpenAPI/GraphQL API keys should be stored in the vault and injected at execution time. | Synergy |
| **Workflow Builder** | The workflow builder (Feature 4) needs nodes. The catalog IS the node library. | **Critical dependency** |

---

### B) Implementation Complexity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Extend `ToolCatalog` schema to store normalized MCP schemas from OpenAPI/GraphQL | `src/tool-catalog/index.ts` | 6h |
| 2 | Implement OpenAPI spec fetcher + parser (`swagger-parser` or `@apidevtools/swagger-parser`) | `src/tool-catalog/fetchers/openapi.ts` | 10h |
| 3 | Implement GraphQL introspection client + schema parser | `src/tool-catalog/fetchers/graphql.ts` | 10h |
| 4 | Implement schema normalizer: OpenAPI → MCP tool schema, GraphQL → MCP tool schema | `src/tool-catalog/normalizers/to-mcp.ts` | 12h |
| 5 | Implement MCP server discovery (connect to external MCP, list tools, register in catalog) | `src/tool-catalog/fetchers/mcp-discovery.ts` | 8h |
| 6 | Implement semantic search with embeddings (local `@xenova/transformers` or API) | `src/tool-catalog/search/semantic.ts` | 10h |
| 7 | Implement execution runtime: HTTP executor for OpenAPI, GraphQL client, MCP proxy | `src/tool-catalog/executor/*` | 12h |
| 8 | Integrate with Vault for API key injection | `src/tool-catalog/policies/auth.ts` | 6h |
| 9 | Add MCP tools: `catalog_add_source`, `catalog_search`, `catalog_execute` | `src/server/mcp.ts` | 4h |
| 10 | Add HTTP endpoints: `/v1/catalog/sources`, `/v1/catalog/search`, `/v1/catalog/execute` | `src/server/http.ts` | 6h |
| 11 | Dashboard UI for source management and tool discovery | `dashboard/src/catalog/*` | 10h |
| 12 | Tests for fetchers, normalizers, executor, search | `test/tool-catalog/*.test.ts` | 14h |

**Total estimate:** ~108 hours (roughly 2.5–3 developer-weeks).  
**Effort classification:** **L** (not XL because the skeleton exists and the patterns are well-understood). The heavy lifting is schema normalization, which is mechanical, not architectural.

#### Technical dependencies

- `@apidevtools/swagger-parser` — OpenAPI parsing and validation.
- `graphql` — GraphQL introspection query execution.
- `@xenova/transformers` or `onnxruntime-node` — local embeddings for semantic search (optional; can use API fallback).
- `@modelcontextprotocol/sdk` (already in deps) — for MCP server discovery.

---

### C) Standards & Maturity Analysis

| Signal | Assessment |
|--------|------------|
| **Stars / Forks** | 1.8k / 114 — strong community traction |
| **Releases** | 76 releases, v1.4.33 — very mature release cycle |
| **TypeScript + Effect** | Modern functional programming stack; code quality is high |
| **Plugin architecture** | Reference projects listed: Better Auth, Effect, OpenCode, OpenClaw, Emdash, Pi |
| **MCP server mode** | Can expose its catalog as an MCP server — exactly what the bridge needs |

**Spec gaps:**
1. **No standard for "unified tool schema."** MCP, OpenAPI, and GraphQL have fundamentally different schema languages. Normalizing them to MCP's JSON Schema is lossy (GraphQL unions/interfaces don't map cleanly).
2. **No standard for "tool intent."** Intent-based search requires embeddings or LLM reranking. There is no standard query format for "find me a tool that sends emails."
3. **Auth portability:** OpenAPI uses `Authorization: Bearer`, GraphQL uses custom headers, MCP uses stdio/env. A unified auth model is necessarily an abstraction with edge cases.

---

### D) Integration with Consumers

| Consumer | How they would consume | Changes needed | Breaking? |
|----------|------------------------|----------------|-----------|
| **biogas** | Instead of biogas calling APIs directly, it calls `catalog_execute` via the bridge, which handles auth, retries, and policy. | Adopt `catalog_execute` MCP tool | No — opt-in |
| **ghagga** | ghagga can discover GitHub tools via intent search instead of hardcoding Octokit. | Adopt `catalog_search` | No — opt-in |
| **javi-ai** | javi-ai's agents can dynamically discover and use tools from the catalog at runtime. | Adopt `catalog_search` + `catalog_execute` | No — opt-in |
| **repoforge** | repoforge can auto-register OpenAPI specs from repositories and expose them as MCP tools. | Use HTTP API to add sources | No — additive |

**Backwards compatibility:** Existing MCP tools (`llm_generate`, `vault_store`, etc.) are untouched. The catalog is additive. **However**, if the bridge eventually wants to expose ALL tools (internal + external) through a unified interface, the current `TOOLS` array in `src/server/mcp.ts` should be registered in the catalog at startup.

---

### E) Prioritization within this domain

**Position:** 1st of 4 (build first).  
**Why:** It is the enabler for the workflow builder (Feature 4) and it makes the bridge significantly more valuable as a gateway. Today the bridge is an LLM proxy + credential vault. With a unified tool catalog, it becomes an **integration platform** — the hub through which all AI tools flow. That is a massive value proposition for every consumer.

**Can be built in parallel with:** JSONL streaming (Feature 1). They touch different domains (registry vs. observability).

---

### F) Open Questions / Risks

#### What is unknown or speculative?

1. **Schema normalization fidelity:** How well does OpenAPI 3.x map to MCP's JSON Schema? OpenAPI has `allOf`, `anyOf`, `oneOf`, `discriminator` — MCP JSON Schema supports these, but not all clients handle them well.
2. **GraphQL mutation exposure:** GraphQL mutations are effectively remote procedure calls. Exposing them as MCP tools is powerful but dangerous (arbitrary mutations). Need strict categorization.
3. **MCP server lifecycle:** If an external MCP server crashes, the catalog holds stale tool definitions. Need health checking and auto-removal.

#### What could derail implementation?

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **OpenAPI spec incompatibility** | High | Medium | Support OpenAPI 3.0/3.1 only. Reject Swagger 2.0. Use `swagger-parser` for validation. |
| **GraphQL complexity** | Medium | High | Scope v1 to queries only. Mutations require approval flow integration. |
| **Embedding model size** | Medium | Medium | Use API fallback (OpenAI `text-embedding-3-small`) if local model download is too heavy. |
| **Tool execution sandbox** | High | Critical | External HTTP calls can hit internal services. Network policies + URL allowlists required. |

#### Is this partially implemented?

**Yes — skeleton only.** `src/tool-catalog/index.ts` has the `ToolCatalog` class with keyword search and JSON serialization. It is **not wired** into `src/server/mcp.ts` (no `catalog_*` tools). It has no OpenAPI fetcher, no GraphQL client, no semantic search, and no execution runtime. It is approximately **15% complete**.

---

---

## Feature 4: Batch 6 #1 — Visual Workflow Builder

### Source Project: `simstudioai/sim` (v0.6.92, TypeScript/Next.js/ReactFlow, Apache-2.0)

**What it does:** Open-source AI agent workflow platform. Drag-and-drop canvas to build agentic workflows. Connect nodes (LLM calls, tool executions, conditionals, loops), then run them. 28.6k stars, 4,774 commits, commercial product at sim.ai.

**Key architectural insights from source code inspection:**
- **Frontend:** Next.js App Router + ReactFlow (`reactflow` v11) for the canvas + Zustand for state + TanStack Query for data.
- **Backend:** Drizzle ORM + PostgreSQL + pgvector. Trigger.dev for background jobs. E2B + `isolated-vm` for sandboxed code execution.
- **Realtime:** Socket.io server (`apps/realtime`) for live execution updates.
- **Scale:** Helm charts for K8s deployment. Load testing with Artillery.

---

### A) Technical Architecture

#### Where it fits in mcp-llm-bridge

The bridge has a **dashboard** (`dashboard/`) built with React + Vite. It is currently an admin/status dashboard, not a workflow canvas. The bridge has **no workflow engine**, **no node execution runtime**, and **no visual designer**.

Adding a visual workflow builder means building **three major subsystems**:

```
┌─────────────────────────────────────────────────────────────┐
│                Visual Workflow Builder                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Canvas Layer (ReactFlow)                           │   │
│  │  - Node types: LLM Generate, Tool Call, Conditional, │   │
│  │    Loop, Wait, Merge, CRDT Read/Write              │   │
│  │  - Edge types: success, error, conditional            │   │
│  │  - Drag, drop, connect, zoom, pan, minimap         │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Workflow Engine (backend)                          │   │
│  │  - DAG validation (no cycles, connected components)   │   │
│  │  - Topological execution order                      │   │
│  │  - State machine per workflow instance              │   │
│  │  - Error handling: retry, fallback, abort            │   │
│  │  - Persistence: workflow definitions + run history  │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Execution Runtime                                    │   │
│  │  - Node executors: LLM generate → Router.generate()   │   │
│  │  - Tool call → ToolCatalog.execute()                  │   │
│  │  - Conditional → JS expression eval (isolated-vm)   │   │
│  │  - Loop → iterate with context                        │   │
│  │  - CRDT → StateManager.read/write                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### New modules needed

| Module | Purpose | Files |
|--------|---------|-------|
| `dashboard/src/workflows/` | ReactFlow canvas UI | `dashboard/src/workflows/Canvas.tsx`, `dashboard/src/workflows/NodePalette.tsx`, `dashboard/src/workflows/NodeTypes/*.tsx` |
| `src/workflow/` | Workflow engine core | `src/workflow/engine.ts`, `src/workflow/validator.ts`, `src/workflow/types.ts`, `src/workflow/persistence.ts` |
| `src/workflow/nodes/` | Node executors | `src/workflow/nodes/llm-generate.ts`, `src/workflow/nodes/tool-call.ts`, `src/workflow/nodes/conditional.ts`, `src/workflow/nodes/loop.ts`, `src/workflow/nodes/crdt.ts` |
| `src/workflow/runtime/` | Execution runtime | `src/workflow/runtime/executor.ts`, `src/workflow/runtime/context.ts`, `src/workflow/runtime/sandbox.ts` |
| `src/server/workflows.ts` | HTTP API for CRUD workflows + trigger execution | `src/server/workflows.ts` |

#### Interaction with existing features

| Feature | Interaction | Impact |
|---------|-------------|--------|
| **MB-1 (Bridge)** | LLM Generate node uses `BridgeOrchestrator` for task-aware routing. | Synergy |
| **MB-2 (Compression)** | Workflow context (variables passed between nodes) can be compressed if large. | Opportunity |
| **MB-3 (CRDT)** | CRDT nodes enable multi-agent workflows where agents share state. | **High synergy** |
| **MB-4 (Code Search)** | Code Search node can be dropped into a workflow to find relevant code before generation. | Synergy |
| **Unified Tool Catalog** | Tool Call node sources its tool list from the catalog. | **Hard dependency** |
| **Security Profiles** | Workflow definitions should respect security profiles (no destructive tools in `open` profile). | Required |
| **Approval Flows** | Destructive tool calls in workflows should trigger approvals. | Required |
| **Vault** | API keys for external tools in workflows come from the vault. | Synergy |
| **Session Store** | Workflow runs can be associated with sessions. | Opportunity |

---

### B) Implementation Complexity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Design workflow schema (DAG JSON: nodes, edges, metadata) | `src/workflow/types.ts` | 8h |
| 2 | Implement ReactFlow canvas with custom node types | `dashboard/src/workflows/*` | 20h |
| 3 | Implement workflow engine (DAG validation, topo sort, state machine) | `src/workflow/engine.ts`, `src/workflow/validator.ts` | 16h |
| 4 | Implement node executors (LLM generate, tool call, conditional, loop, wait) | `src/workflow/nodes/*` | 20h |
| 5 | Implement execution runtime with context passing and error handling | `src/workflow/runtime/*` | 16h |
| 6 | Implement workflow persistence (SQLite: `workflows`, `workflow_runs`, `run_steps` tables) | `src/workflow/persistence.ts` | 10h |
| 7 | Implement HTTP API for workflow CRUD + trigger + run status | `src/server/workflows.ts` | 10h |
| 8 | Add MCP tools: `workflow_create`, `workflow_run`, `workflow_status` | `src/server/mcp.ts` | 6h |
| 9 | Implement sandboxed JS expression evaluation (conditional logic) | `src/workflow/runtime/sandbox.ts` | 8h |
| 10 | Real-time execution updates (SSE or WebSocket) | `src/server/sse-stream.ts` | 8h |
| 11 | Dashboard UI for run history, logs, replay | `dashboard/src/workflows/RunHistory.tsx` | 10h |
| 12 | Tests: engine, executors, runtime, persistence | `test/workflow/*.test.ts` | 20h |

**Total estimate:** ~152 hours (roughly 4 developer-weeks).  
**Effort classification:** **XL**. This is a product-sized feature, not a module.

#### Technical dependencies

- `reactflow` (npm) — canvas library. v11 is current; v12 is in beta. Stick with v11 for stability.
- `zustand` (already in dashboard?) — workflow client-side state. If not present, add it.
- `isolated-vm` (npm) — sandboxed JS execution for conditionals. **Native dependency** (requires Node.js headers, Python, make). Adds build complexity.
- `better-sqlite3` (already present) — workflow persistence.

---

### C) Standards & Maturity Analysis

| Signal | Assessment |
|--------|------------|
| **Stars / Forks** | 28.6k / 3.6k — enormous community, most popular of all 4 reference projects |
| **Releases** | 290 releases — weekly release cadence, extremely mature |
| **Commercial product** | sim.ai — validated product-market fit |
| **Tech stack** | Next.js, ReactFlow, Drizzle, PostgreSQL, Zustand, Trigger.dev — modern, proven |
| **Deployment** | Docker Compose, Helm charts, K8s — production-ready |
| **Documentation** | docs.sim.ai, Fumadocs — comprehensive |

**Spec gaps:**
1. **No standard for "visual MCP workflow definition."** sim has its own node/edge schema. The bridge would need to invent one or adopt sim's.
2. **No standard for "workflow execution state machine."** Each platform (Sim, n8n, LangChain) has its own. Interoperability is zero.
3. **ReactFlow lock-in:** The visual layer is tightly coupled to ReactFlow. Switching canvas libraries later is a full rewrite.

---

### D) Integration with Consumers

| Consumer | How they would consume | Changes needed | Breaking? |
|----------|------------------------|----------------|-----------|
| **biogas** | Build deployment workflows visually: "index code → find bugs → generate fix → open PR" | Use dashboard or HTTP API | No — additive |
| **ghagga** | Code review workflow: "fetch PR → analyze → comment → approve/reject" | Use dashboard or HTTP API | No — additive |
| **javi-ai** | Agent orchestration: multi-step agent with tool loops and human-in-the-loop | Use MCP `workflow_run` | No — additive |
| **repoforge** | Repo analysis pipeline: "clone → index → search → report" | Use dashboard or HTTP API | No — additive |

**Backwards compatibility:** 100% additive. Workflows are a new capability. Existing APIs unchanged.

---

### E) Prioritization within this domain

**Position:** 2nd of 4 (after unified tool catalog).  
**Why:** It is the most impactful user-facing feature but it **depends on the unified tool catalog** for its Tool Call node. Building the workflow builder first with only the bridge's 15 internal tools is underwhelming. Building it after the catalog can call 100+ external tools is compelling.

**Can be built in parallel with:** JSONL streaming (Feature 1) after the catalog is done.

---

### F) Open Questions / Risks

#### What is unknown or speculative?

1. **Scope boundary:** Sim is a full product (28.6k stars, 290 releases). The bridge cannot absorb all of Sim. What is the MVP? → Suggestion: DAG editor + LLM + Tool Call + Conditional + Loop. Skip E2B, skip Trigger.dev, skip K8s operator.
2. **Frontend maintenance:** Adding ReactFlow + workflow state to the dashboard turns it from a simple admin panel into a complex application. Who maintains it?
3. **Execution isolation:** If workflows can execute arbitrary tools, a malicious workflow definition could exfiltrate vault credentials. Need workflow-level sandboxing.

#### What could derail implementation?

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Scope explosion** | Very High | Critical | Define MVP strictly: 5 node types, no custom JS nodes, no external triggers. |
| **isolated-vm build failures** | High (in Docker/alpine) | High | Test `isolated-vm` in the bridge's Docker image early. Fallback: `vm2` (deprecated) or no sandbox (trust workflows). |
| **ReactFlow version churn** | Medium | Medium | Pin `reactflow@^11.11.4`. Do not upgrade to v12 during initial build. |
| **Workflow engine bugs** | Medium | Critical | Extensive property-based testing for DAG validation and cycle detection. |

#### Is this partially implemented?

**No.** The bridge has no workflow engine, no ReactFlow canvas, no node executors, no workflow persistence tables, and no workflow HTTP API. The closest thing is `BridgeOrchestrator` (task-aware routing), which is a single-step decision maker, not a multi-step workflow engine.

---

---

## Cross-Cutting Analysis

### The "Dead Code" Pattern — Continued

Prior investigations found that many features exist as **unwired modules** (security profiles, approval flows, Docker sandbox, ACP, MCP builder, etc.). For this batch of four, the pattern is **less prevalent**:

| Feature | Partially Implemented? | Location | Completeness |
|---------|----------------------|----------|------------|
| **MB-6 JSONL streaming** | ❌ No | — | 0% |
| **MB-8 Multi-backend storage** | ❌ No | — | 0% |
| **Batch 5 #1 Unified tool catalog** | ⚠️ Skeleton | `src/tool-catalog/index.ts` | ~15% |
| **Batch 6 #1 Visual workflow builder** | ❌ No | — | 0% |

**Implication:** Three of these four are genuine green-field builds. Effort estimates must be taken seriously — there is no existing code to wire.

### Security Implications

| Feature | New Attack Surface | Mitigation Strategy |
|---------|-------------------|---------------------|
| **MB-6 JSONL streaming** | SSE endpoint leaks tool outputs containing secrets; file watcher reads arbitrary files if misconfigured | Redact vault credentials from streamed logs; restrict watched directories |
| **MB-8 Multi-backend storage** | Postgres/Redis credentials in env vars; migration scripts run arbitrary SQL | Vault should encrypt backend credentials; migration dry-run mandatory |
| **Unified tool catalog** | External OpenAPI/GraphQL tools can hit internal services; SSRF | URL allowlist; network isolation; require approval for new sources |
| **Visual workflow builder** | Malicious workflow definitions; arbitrary tool execution chains | Workflow sandboxing; security profile enforcement per workflow; approval for destructive nodes |

**Critical observation:** The workflow builder and unified tool catalog **compound each other's security risk**. A malicious actor who can register an OpenAPI source AND create a workflow can chain them into an automated attack. The two features must share a unified security policy layer.

### Effort vs Impact Matrix

| Feature | Effort | Consumer Impact | Infrastructure Impact | Strategic Value |
|---------|--------|-----------------|----------------------|-----------------|
| **Unified tool catalog** | L | 🔥🔥🔥 High | Medium | 🔥🔥🔥 Gateway becomes integration platform |
| **Visual workflow builder** | XL | 🔥🔥🔥 High | 🔥🔥 High | 🔥🔥🔥 Product differentiator |
| **JSONL streaming** | L | Medium | Low | Medium (observability enabler) |
| **Multi-backend storage** | XL | Low | 🔥🔥🔥 Foundation | Low (unless scaling) |

### Recommended Build Order

| Order | Feature | Rationale | Parallelizable? |
|-------|---------|-----------|-----------------|
| **1st** | **Unified tool catalog** | Unlocks the workflow builder. Independent value for all consumers. Enables integration platform positioning. | ✅ With JSONL streaming |
| **2nd** | **Visual workflow builder** | Hard dependency on catalog. Biggest user-facing impact. | ❌ Must wait for catalog |
| **3rd** | **JSONL streaming** | Valuable for debugging multi-agent workflows (which the workflow builder enables). | ✅ With catalog |
| **4th** | **Multi-backend storage** | Foundation work with no user-facing value. Only build when scaling requirements force it. | ❌ Serial refactor |

### The Catalog → Workflow Synergy

If built together (sequentially, not in parallel), the two features create a **flywheel**:

```
1. Add OpenAPI source (GitHub API) ──→ Catalog registers 50 tools
2. Build workflow: "Fetch repo → Search issues → Generate comment"
        │                              │
        ▼                              ▼
   Tool Call nodes                 LLM Generate node
   (from catalog)                  (bridge router)
        │                              │
        └──────────────┬───────────────┘
                       ▼
              Unified execution runtime
                       │
                       ▼
              Stream JSONL logs live
                       │
                       ▼
              Dashboard shows run progress
```

Without the catalog, the workflow builder has ~15 internal tools. With the catalog, it has hundreds.

---

## Appendix: Detailed Codebase State Audit

### Files Found Related to These Features

| Path | What it does | Relevance to features |
|------|-------------|----------------------|
| `src/tool-catalog/index.ts` | `ToolCatalog` class with keyword search | Batch 5 #1 skeleton (~15% complete) |
| `src/logging/index.ts` | Request logger types and schemas | MB-6 foundation (no streaming) |
| `src/logging/request-logger.ts` | `RequestLogger` class (unwired?) | MB-6 foundation |
| `src/db/migrate.ts` | SQLite-only migration runner | MB-8 foundation (SQLite only) |
| `src/server/http.ts` | Hono HTTP server with SSE for chat | MB-6 SSE can reuse `streamSSE` |
| `src/server/mcp.ts` | MCP tool server with 15 tools | All features add tools here |
| `dashboard/` | React+Vite admin dashboard | Batch 6 #1 frontend foundation |
| `src/bridge/orchestrator.ts` | Task-aware routing | Batch 6 #1 LLM node uses this |
| `src/crdt/index.ts` | CRDT state manager | Batch 6 #1 CRDT node uses this |
| `src/core/router.ts` | Provider router | Batch 6 #1 LLM node uses this |

### Files NOT Found (Confirming Green-Field Status)

| Expected Path | Feature | Confirms |
|---------------|---------|----------|
| `src/streaming/` | MB-6 | Green-field |
| `src/streaming/watcher.ts` | MB-6 | Green-field |
| `src/streaming/parser.ts` | MB-6 | Green-field |
| `src/storage/` | MB-8 | Green-field |
| `src/storage/backends/` | MB-8 | Green-field |
| `src/storage/migrate.ts` | MB-8 | Green-field |
| `src/tool-catalog/fetchers/` | Batch 5 #1 | Missing subsystems |
| `src/tool-catalog/executor/` | Batch 5 #1 | Missing subsystems |
| `src/tool-catalog/search/semantic.ts` | Batch 5 #1 | Missing subsystems |
| `src/workflow/` | Batch 6 #1 | Green-field |
| `src/workflow/engine.ts` | Batch 6 #1 | Green-field |
| `src/workflow/nodes/` | Batch 6 #1 | Green-field |
| `dashboard/src/workflows/` | Batch 6 #1 | Green-field |

### Package.json Dependency Gaps

```json
{
  "dependencies": {
    // MB-6: JSONL streaming
    "chokidar": "^4.0.0",
    
    // MB-8: Multi-backend storage
    "pg": "^8.15.0",
    "ioredis": "^5.6.0",
    "@libsql/client": "^0.15.0",
    
    // Batch 5 #1: Unified tool catalog
    "@apidevtools/swagger-parser": "^10.1.1",
    "graphql": "^16.10.0",
    "@xenova/transformers": "^2.17.2",
    
    // Batch 6 #1: Visual workflow builder
    "reactflow": "^11.11.4",
    "zustand": "^5.0.3",
    "isolated-vm": "^6.0.2"
  }
}
```

### Version Discrepancy Reminder

The README still references v0.3.1 in health check examples, but `package.json` is v0.5.1. Update README as part of any release that ships these features.

---

## Conclusion of the Architect

**You have a classic platform build-ahead-of-demand problem.** Three of four features are green-field, and the most strategically valuable one (visual workflow builder) is blocked by another (unified tool catalog). The foundation work (multi-backend storage) is large but not yet needed by any known consumer.

**Recommended action plan:**

1. **Start with the unified tool catalog.** It is the highest-leverage, lowest-risk starting point. It builds on an existing skeleton. It delivers value immediately. It unlocks the workflow builder.
2. **Do NOT start the workflow builder until the catalog is solid.** A canvas with 15 tools is a demo. A canvas with 100+ tools is a product.
3. **Run JSONL streaming in parallel with the catalog.** It is independent, valuable for observability, and reasonably scoped.
4. **Defer multi-backend storage until a consumer demands it.** It is a 3-week foundation refactor with zero user-facing value. It is critical for scale, but you are not at scale yet.
5. **Address the security wiring FIRST.** Before adding any new tool execution surface (catalog, workflow builder), the existing `ProfileEnforcer` must be wired into HTTP and the approval flow must be functional. The prior investigation found these are unwired — that is a prerequisite, not optional.

**Tony Stark didn't build the Iron Man suit by starting with the flight stabilizers. He started with the reactor arc because everything else depended on it. The unified tool catalog is your reactor arc.**

---

*Investigation completed: 2026-05-27*
