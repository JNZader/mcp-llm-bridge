# Architecture and runtime-reliability findings

The bootstrap is already decomposed into useful modules, but runtime ownership is incomplete: request deadlines do not propagate, synchronous subprocesses block the event loop, and shutdown does not own the transports that accept work.

## Architecture baseline

The current structure provides a credible base for incremental hardening:

- `src/index.ts` selects commands and creates the runtime.
- `src/bootstrap/runtime-foundation.ts` composes vault, SQLite, migrations, and router foundation.
- `src/bootstrap/router-baseline.ts` and `router-features.ts` separate baseline adapters from advanced routing features.
- `src/bootstrap/server-startup.ts` selects HTTP/MCP startup modes.
- Routing includes provider aliases/groups, stickiness, circuit breakers, fallback behavior, transformations, usage/cost components, and observability integrations.

The recommendation is consolidation, not a rewrite.

## RUN-01 — HTTP timeout does not cancel work

**Priority:** P1 / High

### Evidence

The timeout callback only flips `timedOut`; middleware still awaits `next()` and returns 408 afterward: `src/server/http-app.ts:162-181`. A representative CLI adapter invokes its process without a request cancellation signal: `src/adapters/base-cli-adapter.ts:125-143`.

### Impact

Provider calls, streams, plugins, or subprocesses continue consuming CPU, memory, provider quota, and money after the client deadline. Under load, timed-out requests can accumulate and exhaust capacity.

### Existing controls

There is a two-minute HTTP deadline and subprocess-level timeout defaults. These bound some durations but are disconnected and do not provide end-to-end cancellation.

### Recommendation

1. Create an `AbortController` at HTTP/MCP ingress.
2. Compose client disconnect, server deadline, shutdown, and provider deadline signals.
3. Add `signal` to request, routing-plan, transformer, adapter, stream, and plugin contracts.
4. Abort fetches and kill subprocess groups on cancellation.
5. Stop token/cost accounting correctly for partial outputs and record cancellation reason.
6. Test cancellation before dispatch, during provider fetch, during stream, during CLI execution, and during shutdown.

## RUN-02 — Synchronous CLIs block the event loop

**Priority:** P1 / High

`execCliSync()` uses `execFileSync`: `src/adapters/cli-utils.ts:68-96`. `BaseCliAdapter` invokes it on the request path: `src/adapters/base-cli-adapter.ts:142-143`.

Even with a subprocess timeout, Node cannot serve unrelated HTTP/MCP work while the synchronous call is active. Replace request-path sync execution with async `spawn`/`execFile`, stream output with bounded buffers, attach an abort signal, kill the process group on cancellation, and enforce per-provider concurrency semaphores and bounded queues.

## RUN-03 — Shutdown does not drain transports

**Priority:** P1 / High

### Evidence

Startup invokes HTTP/MCP constructors but does not retain their returned handles in a unified runtime handle: `src/bootstrap/server-startup.ts:79-113`. `ShutdownDeps` includes services, stores, vault, home cleanup, and tracing, but no HTTP or MCP transport: `src/bootstrap/shutdown.ts:30-44`. Cleanup destroys internal dependencies and exits: `src/bootstrap/shutdown.ts:71-123`.

### Impact

The process may continue accepting work while services or the database are being destroyed. In-flight streams can be truncated, requests can observe closed dependencies, and orchestrator termination deadlines may force an abrupt exit.

### Recommendation

Return a `RuntimeHandles` object owning HTTP server, MCP server/transports, in-flight registry, background tasks, services, and database. Shutdown order should be:

1. Mark readiness false.
2. Stop accepting new HTTP/MCP work.
3. Signal cancellation to requests exceeding the drain window.
4. Await in-flight work and flush streams.
5. Stop background jobs and service dependencies.
6. Flush telemetry.
7. Close stores/database and temporary homes.
8. Exit with a bounded overall deadline and structured failure report.

## RUN-04 — Model-routing config path is bundle-sensitive

**Priority:** P2 / Medium

`loadConfig()` computes a project root by walking two levels up from `import.meta.url`, reads `model-routing.json`, and returns `null` for missing, parse, or validation failures: `src/model-routing/config.ts:197-227`. The npm package includes only `dist` and `README.md`: `package.json:6-9`.

From source, two levels can locate the repository root. From flat/bundled chunks under `dist`, the same assumption can resolve a different directory, while the package may not contain `model-routing.json`. Silent `null` makes the defect look like a disabled feature.

### Recommendation

- Define an explicit config-path precedence: CLI flag, environment variable, working-directory config, packaged default.
- Include any required default/example in package `files` or embed it at build time.
- Distinguish missing optional configuration from invalid configuration; invalid configured files should fail loudly.
- Add tests against source execution, built `dist`, `npm pack` installation, and container runtime.

## ARC-01 — Transport contracts have multiple sources of truth

**Priority:** P2 / Medium

MCP declarations live in `src/server/mcp-tool-registry.ts`, dispatch mapping in `src/server/mcp-dispatcher.ts`, handler wiring in `src/server/mcp-server.ts:272-321`, and HTTP Zod schemas in `src/core/schemas.ts`. The current chat schema, for example, supports only three roles and string content (`src/core/schemas.ts:28-46`). Parallel definitions can drift in required fields, accepted shapes, security metadata, and error behavior.

### Recommendation

Use one Zod 4 domain contract per operation, then generate/infer:

- TypeScript input/output types.
- HTTP validation and OpenAPI schemas.
- MCP JSON Schema declarations.
- Dispatcher registration and operation metadata.
- Security category, approval requirement, and audit-event metadata.

Add a test that every registered operation has one handler, one schema, one security policy, and equivalent required/optional fields across exposed transports.

## ARC-02 — Router remains a broad mutable orchestrator

**Priority:** P2 / Medium

`Router` declares nine nullable feature dependencies plus mutable exploration/fallback state at `src/core/router.ts:159-170`. Those dependencies are installed after construction through setters at `src/core/router.ts:172-263`. The same class exposes distinct orchestration entry points for legacy generation (`generate`, line 318), internal generation (`generateFromInternal`, line 531), streaming resolution (`resolveStreamingProvider`/`resolveStreamingProviders`, lines 699-813), and model/status discovery (`getAvailableModels`/`getProviderStatuses`, lines 814-841). This concrete breadth persists despite the extracted planner, executor, telemetry, shaping, and execution-contract modules imported at `src/core/router.ts:36-68`. It increases initialization-order coupling, makes sync/stream behavior easier to diverge, and complicates isolated tests.

### Recommendation

- Produce an immutable `RoutingPlan` containing resolved provider/model, policy decision, fallback chain, budgets, transformers, telemetry context, and cancellation signal.
- Execute sync and streaming requests from the same plan.
- Inject dependencies through constructors/factories rather than post-construction setters.
- Keep policy selection pure where possible; isolate side effects in executors.
- Characterize current behavior before decomposition to avoid changing fallback and cost semantics.

## ARC-03 — Database lifecycle ownership is fragmented

**Priority:** P2 / Medium

`createRuntimeFoundation()` obtains the vault-owned connection with `vault.getDb()`, but separately passes the same `dbPath` into migration and service construction: `src/bootstrap/runtime-foundation.ts:18-30`. `createCoreServices()` then gives the shared connection to `RequestLogger` and `SQLiteAnalyticsWriter`, while constructing `CostTracker` and `GroupStore` from the path: `src/bootstrap/core-services.ts:42-50`. Those two classes each open and own another `better-sqlite3` connection (`src/core/cost-tracker.ts:205-223`; `src/core/groups.ts:97-109`) and close it themselves (`src/core/cost-tracker.ts:539-543`; `src/core/groups.ts:300-303`). Shutdown therefore needs separate close/destroy dependencies for these resources and the vault (`src/bootstrap/shutdown.ts:30-44,89-100`) rather than delegating to one database lifecycle owner. This mixture makes transaction boundaries, migration coordination, and close ownership implicit.

### Recommendation

Create a `DatabaseContext` that owns migration, connection/factory policy, transaction boundaries, health/readiness checks, and final close. Services receive repositories or scoped transactions rather than independently interpreting a path. Document which component may close each resource.

## Reliability controls to add

| Control | Purpose | Minimum evidence |
| --- | --- | --- |
| Provider semaphore | Prevent one provider from exhausting process capacity | Concurrent load test and queue metrics |
| Bounded request queue | Apply backpressure before memory exhaustion | Deterministic overload response test |
| Tenant quota | Bound noisy-neighbor and cost impact | Cross-tenant load isolation test |
| Circuit breaker integration | Avoid repeated calls to degraded providers | State-transition and recovery tests |
| Idempotency where mutations exist | Prevent duplicate storage/admin operations | Retry and duplicate-delivery tests |
| Drain deadline | Bound shutdown while preserving in-flight work | SIGTERM integration test |
| Readiness state | Remove instance before teardown | Orchestrator health test |

## Architecture verification checklist

- [ ] A single abort signal reaches HTTP fetch, streams, CLIs, and plugins.
- [ ] No request-path adapter uses synchronous process APIs.
- [ ] HTTP and MCP handles are closed before database/service teardown.
- [ ] Packaged and containerized model routing load behavior is tested.
- [ ] Every exposed operation is generated from or checked against one contract.
- [ ] Sync and streaming execution consume the same routing plan.
- [ ] Every database connection has one documented owner.

