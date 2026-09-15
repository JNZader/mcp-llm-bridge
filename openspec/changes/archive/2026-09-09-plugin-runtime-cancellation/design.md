# Design: Plugin Runtime Cancellation

## Technical Approach

Keep in-process loading as default. Worker mode creates one persistent worker per plugin, imports once, returns a tools-only manifest, and retains handlers. Host identity, security, and collision admission precede a single registry handoff.

## Architecture Decisions

| Decision | Choice and rationale | Rejected alternative |
|---|---|---|
| Configuration | `MCP_DYNAMIC_SERVERS` remains the outer gate; false creates no runtime. When true, extend `src/core/mcp-runtime-config.ts` with `MCP_PLUGIN_RUNTIME_MODE=legacy|worker` (absent: `legacy`; invalid: startup failure), `MCP_PLUGIN_WORKER_ENV_ALLOWLIST` (comma-separated; absent: empty), and worker-required `MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST`. Copy only listed, present host keys; reject duplicates, invalid names, `NODE_OPTIONS`, and `NODE_PATH`. No other config source overrides them. | Boolean flags, inherited environment, `SHARE_ENV`, and implicit fallback violate explicit opt-in. |
| Compatibility | Before import, require evidence matching Node major, platform, architecture, worker-entry hash, and complete installed-plugin digest from package acceptance. Missing/mismatched evidence refuses worker mode; scanning never proves arbitrary native closure. | Import success or extension scanning cannot prove native teardown safety or deployment compatibility. |
| Protocol bounds | Closed shapes are `{v:1,kind:"ready",manifest}`, `{v:1,kind:"invoke",id,tool,args}`, `{v:1,kind:"result",id,result}`, `{v:1,kind:"failure",id?,code}`, and `{v:1,kind:"shutdown"}`. The manifest requires only `v:1,name,version,description,tools`; host-known filename identity must equal `name`. Each tool requires only `name,description,inputSchema,security`; security requires enum `category` (`read|generate|destructive|admin`) and optionally boolean `requiresApproval`. Manifest strings are nonempty; tool names match existing `SNAKE_CASE`, descriptions are strings, and `inputSchema` is a bounded JSON object. `handler`, `examples`, `resources`, and `prompts` are excluded. Reject unknown fields at envelope, manifest, tool, and security levels; arbitrary keys occur only inside `inputSchema`, `args`, and `result`, subject to tool schema. Use `crypto.randomUUID()`; reject duplicate live IDs, transfers, and non-JSON values. Limits: 1 MiB envelope, depth 32, 10,000 nodes/entries/keys, 256 KiB strings, 128-byte IDs. Stable errors: `CONFIG_INVALID`, `COMPATIBILITY_UNESTABLISHED`, `PROTOCOL_INVALID`, `LIMIT_EXCEEDED`, `IMPORT_TIMEOUT`, `WORKER_EXITED`, `INVOCATION_TIMEOUT`, `PLUGIN_QUARANTINED`. Both ends validate; getters/proxies provide no bounded-execution guarantee. | Structured clone is broader than this wire. |
| Diagnostics | Construct workers with `env` from the allowlist, `argv:[]`, `execArgv:[]`, `stdout:true`, `stderr:true`, and no host preload inheritance. Host drains each stream, emits 8 KiB/event and 64 KiB/lifetime maximum with truncation counters, never to MCP stdout. | Automatic piping can corrupt MCP framing; unbounded capture creates memory/log pressure. |
| Lifecycle | Per runtime: `starting -> admitting -> active -> terminating -> exited`; any failed/rejected runtime becomes `quarantined` after observed exit. Import deadline calls `terminate()` and remains pending through `error` until `exit`. One finalizer removes IDs before settlement, drains once, clears listeners/buffers, and never restarts/replays. Invocation timeout deletes/settles only that request and leaves the worker alive; late results are ignored. Each plugin has an independent worker, so sibling state is untouched. | Per-call workers lose closures; terminating on invocation timeout destroys shared plugin state. |

## Data Flow and Ownership

`loader -> worker import -> bounded manifest -> host admission -> registry -> adapter proxy -> invoke/result`

Loader owns pre-admission cleanup. Rejection, startup/worker failure, and MCP connection failure terminate owned runtimes. `RuntimeContext` owns an empty registry; `mcp-server` receives it, and existing idempotent shutdown destroys it first, before services plugins could call. Exit proves only worker lifecycle: no hard-time, sandbox, rollback, descendant, native-I/O, or effect-reversal guarantee.

## File Changes

| File | Action | Purpose |
|---|---|---|
| `src/mcp-builder/plugin-runtime-{protocol,host,registry}.ts` | Create | Bounds, RPC/state machine, retained ownership. |
| `src/mcp-builder/plugin-runtime-worker.ts` | Create | Packaged ESM import and closure dispatch. |
| `src/mcp-builder/{loader,adapter,index}.ts` | Modify | Mode selection, manifest loading, proxy definitions/types. |
| `src/core/mcp-runtime-config.ts` | Modify | Exact configuration parsing. |
| `src/server/mcp-server.ts`, `src/server/mcp.ts` | Modify | Preserve admission/security/collisions and registry injection. |
| `src/bootstrap/{runtime-context,server-startup,shutdown}.ts`, `src/index.ts` | Modify | Lifetime ownership and shutdown order. |
| `tsup.config.ts`, `package.json` | Modify | Deterministic `dist/plugin-runtime-worker.js` ESM entry. |
| `test/mcp-builder/*`, `test/bootstrap/*`, `test/e2e/*` | Modify/Create | Contract and packaged acceptance coverage. |

## Testing Strategy

Unit RED tests cover config, bounds, manifest unknown/missing fields at every closed level, ID collisions, transitions, settlement, and diagnostics. Integration fixtures cover hung top-level await, error-before-exit, admission rejection, startup/connect failure, shutdown races, simultaneous sibling calls/failure, stateful sequential calls, hostile getter/proxy values (without timing claims), oversized messages/output, and late invocation results. Installed-package acceptance verifies the emitted ESM URL/hash, empty allowlist, cleared `execArgv`, state retention, timeout exit acknowledgement, and supported compatibility evidence. This design claims no experiment.

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no executable-file classification changes. |
| Git repository selection | N/A — no Git invocation or cwd authority. |
| Commit state | N/A — no commit/index behavior. |
| Push state | N/A — no push/ref resolution. |
| PR commands | N/A — no PR or shell command composition. |

## Rollout / Rollback

Ship worker support dark with legacy default. Enable only after installed-package evidence exists for each deployment. Roll back by selecting `legacy`; never auto-fallback from an explicit worker request. No open questions; implementation must validate numeric limits without stronger guarantees.
