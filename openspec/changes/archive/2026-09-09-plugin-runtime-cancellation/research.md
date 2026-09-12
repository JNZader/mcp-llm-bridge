# Research: Node.js 22 boundaries for cancellable plugin workers

```yaml
schema: gentle-ai.sdd-research/v1
revision: 1
change: plugin-runtime-cancellation
outcome: done
accessed_at: 2026-09-08T02:41:30-03:00
requested_source_classes:
  - documentation
admission:
  schema: gentle-ai.sdd-research-capability/v1
  status: admitted
  observed_grants:
    - documentation
    - open-web
  used_grants:
    - documentation
```

## Answer first

Node.js 22.23.2 provides a persistent `Worker` boundary that can own both plugin import and later handler calls. `worker.terminate()` asynchronously requests that worker JavaScript stop and resolves when the worker emits its final `exit` event. This is sufficient to design an acknowledged JavaScript-owner termination boundary, but it is not a hard real-time deadline, an OS sandbox, a rollback mechanism, a descendant-process kill guarantee, or proof that native activity has stopped safely.

The confirmed product package remains separate from this evidence: worker mode is opt-in, environment access is an explicit minimal allowlist, worker stdout/stderr are isolated and projected only through bounded diagnostics, the wire is strict bounded JSON-compatible data, failure quarantines without automatic restart and settles pending calls once, native/deployment compatibility fails closed with explicit legacy mode available, and first-slice invocation timeouts remain observational.

## Questions

1. What does Node.js 22 guarantee, and not guarantee, when terminating a persistent worker during import or invocation?
2. What environment and execution options are inherited by default, and what must a minimal explicit environment override?
3. How can worker stdout/stderr be kept away from MCP stdout, and what backpressure remains?
4. How does Node's structured-clone channel differ from the confirmed strict JSON-compatible wire, including functions, accessors, prototypes, getters/proxies, and pre-transfer validation limits?
5. Which worker lifecycle events can support exactly-once pending-call settlement without automatic restart?
6. What limits apply to native addons, spawned processes, native I/O, and already-completed external effects?
7. How should the worker entry be packaged and loaded under the repository's current ESM distribution?
8. Where must startup, rejection, shutdown, and timeout ownership live in the inspected repository?

## Sources

### N22-WORKER-CONSTRUCTOR

- **id:** `N22-WORKER-CONSTRUCTOR`
- **class:** `documentation`
- **title:** `Worker threads — new Worker(filename[, options])`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#new-workerfilename-options
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** “Default: process.env”; stdout/stderr options prevent automatic piping when set to true.

### N22-WORKER-MESSAGING

- **id:** `N22-WORKER-MESSAGING`
- **class:** `documentation`
- **title:** `Worker threads — port.postMessage and cloning considerations`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#portpostmessagevalue-transferlist
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** Values may contain circular references and several built-in types; transfer changes ownership for listed transferable objects.

### N22-WORKER-CLONE-SHAPE

- **id:** `N22-WORKER-CLONE-SHAPE`
- **class:** `documentation`
- **title:** `Worker threads — cloning objects with prototypes, classes, and accessors`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#considerations-when-cloning-objects-with-prototypes-classes-and-accessors
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** “non-enumerable properties, property accessors, and object prototypes are not preserved.”

### N22-WORKER-LIFECYCLE

- **id:** `N22-WORKER-LIFECYCLE`
- **class:** `documentation`
- **title:** `Worker threads — Worker events and terminate()`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#workerterminate
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** Termination stops worker JavaScript “as soon as possible”; its promise fulfills when `exit` is emitted.

### N22-WORKER-ENVIRONMENT

- **id:** `N22-WORKER-ENVIRONMENT`
- **class:** `documentation`
- **title:** `Worker threads — Worker environment differences`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#class-worker
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** Workers expose most Node APIs; environment is copied by default and execution may stop at any point.

### N22-WORKER-STDIO

- **id:** `N22-WORKER-STDIO`
- **class:** `documentation`
- **title:** `Worker threads — stdout, stderr, and synchronous blocking of stdio`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#synchronous-blocking-of-stdio
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** Worker stdio uses message passing and can be blocked by synchronous work in the receiving thread.

### N22-ADDON-WORKERS

- **id:** `N22-ADDON-WORKERS`
- **class:** `documentation`
- **title:** `C++ addons — Worker support`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/addons.html#worker-support
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** Multi-environment addons must use Node-API or be context-aware, and must clean up resources when a worker exits.

### N22-CHILD-LIFECYCLE

- **id:** `N22-CHILD-LIFECYCLE`
- **class:** `documentation`
- **title:** `Child process — subprocess.kill() and descendant behavior`
- **publisher:** Node.js project
- **URL:** https://nodejs.org/download/release/v22.23.2/docs/api/child_process.html#subprocesskillsignal
- **accessed_at:** `2026-09-08T02:41:30-03:00`
- **excerpt:** A delivered signal may not terminate a child; on Linux, killing a parent does not terminate its child processes.

## Validated claims

| Claim | Evidence | Design consequence |
|---|---|---|
| A Worker is an independent JavaScript execution thread with most Node APIs available, not a restricted OS sandbox. | `N22-WORKER-ENVIRONMENT` | Worker isolation must never be described as filesystem, network, credential, or process sandboxing. |
| `worker.terminate()` is asynchronous, requests JavaScript execution to stop as soon as possible, and resolves on the worker's `exit` event. | `N22-WORKER-LIFECYCLE` | Import-time cancellation can wait for an acknowledged owner exit before reporting terminal settlement; no hard deadline should be claimed. |
| Node documents the same termination primitive for the worker, not separate import and invocation primitives. | `N22-WORKER-LIFECYCLE` | Import and invocation differ by product policy and host bookkeeping, not by a stronger Node cancellation API. First-slice invocation timeout can remain observational while import timeout terminates the owner. |
| The `exit` event is final; uncaught worker errors terminate the worker; all worker messages are emitted before `exit`. | `N22-WORKER-LIFECYCLE` | A host runtime can converge message, error, and exit paths into one guarded finalizer, but exactly-once promise settlement remains application logic. |
| Worker environment defaults are broad: `env` defaults to `process.env`, and `execArgv` inherits parent options unless explicitly set. | `N22-WORKER-CONSTRUCTOR`, `N22-WORKER-ENVIRONMENT` | The confirmed minimal allowlist requires constructing an explicit env object and deliberately deciding `execArgv`; omission would contradict the chosen policy. |
| Setting `stdout: true` and `stderr: true` keeps worker output from being automatically piped to the parent's process streams. | `N22-WORKER-CONSTRUCTOR`, `N22-WORKER-STDIO` | The host can keep plugin bytes off MCP stdout and consume worker-owned readable streams through a bounded diagnostic projector. |
| Worker stdio uses message passing and can stall when the receiving event loop is synchronously blocked. | `N22-WORKER-STDIO` | Isolation alone is not a complete backpressure policy; consumption, byte/event limits, truncation, rate policy, and listener cleanup must be explicit. |
| Worker messaging uses structured clone, permits circular references and non-JSON built-ins, and can transfer ownership of selected objects. | `N22-WORKER-MESSAGING` | Node's transport capability is broader than the confirmed wire. The application must reject out-of-contract data and avoid transfer lists for the JSON-compatible protocol. |
| Functions are not cloneable in constructor worker data, while cloned class instances lose prototypes/accessors and become plain-shaped data. | `N22-WORKER-CONSTRUCTOR`, `N22-WORKER-CLONE-SHAPE` | Handler closures must stay worker-owned; manifests carry identifiers and JSON-compatible metadata only. Structured-clone success is not wire-schema validity. |
| Node's documented clone semantics do not establish a side-effect-free way to inspect arbitrary hostile live objects before transfer. | `N22-WORKER-MESSAGING`, `N22-WORKER-CLONE-SHAPE` | A JavaScript deep validator must not be presented as a safe sandbox for getters or proxies. Validate ordinary decoded wire envelopes on receipt; constrain producer behavior and treat malicious live-value prevalidation as unresolved containment, not guaranteed safety. |
| Native addons are not universally worker-compatible; supported addons need Node-API or context-aware construction and worker-exit cleanup. | `N22-ADDON-WORKERS`, `N22-WORKER-ENVIRONMENT` | Confirmed fail-closed worker mode is supportable; universal native-addon compatibility must not be promised without a tested matrix. |
| Worker termination documentation does not state that external effects are rolled back or that processes spawned by worker code are terminated. Node separately documents descendant processes that can outlive their parent. | `N22-WORKER-LIFECYCLE`, `N22-CHILD-LIFECYCLE` | Filesystem/network writes, native I/O, and child processes require separate policy and acceptance boundaries. An acknowledged worker exit proves only the worker lifecycle event. |
| A Worker entry accepts an absolute path, a `./`/`../` path relative to current working directory, or a `file:` URL; inherited preload flags can recursively launch workers. | `N22-WORKER-CONSTRUCTOR`, `N22-WORKER-STDIO` | Installed-output resolution should use a packaged ESM file URL relative to `import.meta.url`, not source-tree or cwd assumptions, and should deliberately set worker execution arguments. |

## Question-by-question findings

### 1. Termination during import versus invocation

A persistent worker can own module evaluation and retain its handler closures afterward. At import timeout, the host may call `terminate()` and await its promise/`exit` before finalizing the load failure. Node says “as soon as possible”, so the timeout threshold and completed termination are two different moments and require separately bounded observability.

For an invocation timeout, the same primitive would destroy the entire per-plugin owner and shared state. The confirmed first slice therefore keeps invocation timeout observational. A timed-out handler may continue, complete side effects, emit diagnostics, or interfere with sibling calls until some later lifecycle event; no termination claim is valid for that path.

### 2. Environment defaults and the explicit minimum

The safe design cannot rely on constructor defaults. `env` defaults to the parent's full environment, `execArgv` inherits parent flags, and `SHARE_ENV` would make mutations visible across threads. The selected product policy requires a newly constructed environment object containing only specifically named keys. Exact key names and precedence remain design work; no credential or host configuration key is implicitly approved.

The runtime should also decide `argv`, `execArgv`, `stdin`, resource limits, worker name, and unmanaged-file-descriptor tracking rather than treating them as security defaults. Resource limits constrain the JS engine; they do not constrain external allocations or transform the Worker into a sandbox.

### 3. Stdio isolation, backpressure, and MCP protection

Use `stdout: true` and `stderr: true`, never automatic piping or inherited host output. Consume both readable streams in the host, but project only bounded structured diagnostics to the existing logger/error channel. No worker-originated byte should be written to MCP stdout.

The application contract still needs maximum bytes per event, aggregate bytes per worker/window, truncation metadata, rate handling, invalid-encoding treatment, and listener cleanup. Node's message-based worker stdio can be delayed by a blocked host event loop, so diagnostic drain cannot be used as the sole proof that termination or call settlement completed.

### 4. Structured clone versus strict JSON-compatible values

Node can transport circular graphs, `Map`, `Set`, `BigInt`, typed arrays, shared memory, and other values that the chosen product wire rejects. It cannot clone functions, and it does not preserve accessors or prototypes. The design must validate a versioned envelope with finite byte, depth, collection, string, and identifier bounds on both sides; successful `postMessage()` is not acceptance.

There is an important containment limit: inspecting an arbitrary live JavaScript object deeply can interact with accessors or proxies. The allowed Node documentation does not promise a side-effect-free pre-transfer introspection primitive. Therefore the design must not claim that a recursive `isJsonValue()` walk safely neutralizes malicious live values. The receiver can safely apply schema and limits to the value it actually receives, but sender-side validation is compatibility/error handling, not a sandbox guarantee. Any stronger producer-side isolation needs a separately justified mechanism or narrower producer contract.

### 5. Lifecycle and exactly-once settlement

Node exposes `online`, `message`, `messageerror`, `error`, and final `exit` events. An uncaught exception emits `error` and terminates the worker; messages precede `exit`. The host should use one runtime state machine and one idempotent finalizer shared by import timeout, explicit shutdown, `error`, `messageerror`, and `exit`.

Exactly-once settlement is not supplied by EventEmitter. The runtime must atomically remove or mark each request ID before resolving/rejecting it, ignore late/duplicate replies, and drain the pending map once on terminal transition. `exit` is the final lifecycle observation; it is not permission to restart. Under confirmed policy A, terminal failure quarantines the plugin and leaves recovery operator-driven.

### 6. Native addons, processes, and external side effects

Node makes addon compatibility conditional and requires addon-owned cleanup for worker exit. Documentation cannot establish compatibility for arbitrary plugin dependency trees. Worker mode must fail closed when compatibility has not been demonstrated; explicitly selecting legacy mode is a separate user choice, not an automatic fallback.

Termination stops worker JavaScript, not history. Effects completed before exit remain completed. The worker has most Node APIs and can spawn processes; Node does not promise that terminating a worker kills descendants. The proposal must exclude rollback, native-I/O cancellation, descendant cleanup, and sandbox guarantees unless separate controls and evidence are added.

### 7. Worker entry packaging and loaders

Local inspection shows `tsup.config.ts` currently bundles only `src/index.ts`, `package.json` publishes `dist` and points both `main` and the CLI to `dist/index.js`, and the package is ESM. A source-only worker path would therefore not be a distributable contract.

The design should add an explicit worker entry to the build and resolve the emitted file with a `file:` URL relative to the importing module, e.g. `new URL('./plugin-runtime-worker.js', import.meta.url)`. The emitted filename must be made deterministic and included by the published `dist` tree. Node's inherited `execArgv` behavior means loaders/preloads also require an explicit policy; a preload that spawns workers can recurse if inherited unchanged.

### 8. Repository lifecycle ownership

Local inspection confirms:

- `src/mcp-builder/loader.ts` races host `import()` against a timer and returns live definitions; it has no execution owner to terminate.
- `src/mcp-builder/adapter.ts` retains handler closures and uses another observational `Promise.race`; its per-tool health state does not settle a plugin-wide pending-call map.
- `src/bootstrap/server-startup.ts` awaits `startMcpServer()` but returns `Promise<void>`, discarding any plugin-runtime owner.
- `src/bootstrap/shutdown.ts` has an idempotent shared cleanup promise and ordered best-effort cleanup, but no plugin-runtime dependency.
- `tsup.config.ts` has only the main entry and `package.json` publishes the `dist` directory.

The design therefore needs one host-owned runtime registry whose ownership transfers only after successful admission. Startup/import failure and collision/security rejection must close unadmitted workers. The admitted registry must be retained by the bootstrap runtime and destroyed by the existing idempotent shutdown sequence. Termination and pending-call settlement belong to that registry, not to MCP stdout or to a discarded local loader variable.

## Confirmed product choices — non-authoritative evidence

These choices were confirmed by the user; they are requirements for proposal/design and are not conclusions drawn from Node documentation.

| Group | Confirmed A policy |
|---|---|
| Configuration and environment | Opt-in worker mode with a minimal explicit environment allowlist; legacy remains default. |
| Worker stdio and diagnostics | Isolated stdout/stderr with bounded host-projected diagnostics. |
| Wire values | Strict bounded JSON-compatible manifest, arguments, and results. |
| Failure, restart, and shared state | No automatic restart; quarantine the plugin and settle all pending calls exactly once. |
| Native addons and deployment | Fail closed when worker compatibility is not established; explicit legacy mode remains available. |
| Invocation timeout | Keep invocation timeout observational; do not terminate the worker in the first slice. |

No implementation authorization follows from these choices. RDD remains disabled and `containment-and-evidence-harness` remains unchanged.

## Contradictions and resolutions

| Tension | Resolution for proposal |
|---|---|
| Node defaults worker `env` to `process.env`; product policy requires a minimal allowlist. | Always pass an explicit environment object; never rely on the default or `SHARE_ENV`. |
| Node automatically pipes worker stdout/stderr unless capture options are enabled; MCP reserves stdout for protocol traffic. | Set both capture options and project only bounded diagnostics through host-controlled logging. |
| Node structured clone accepts many non-JSON values; product policy requires strict JSON-compatible data. | Define and enforce a narrower versioned schema; transport capability does not expand the product wire. |
| Node permits worker termination for any phase; product policy terminates import but leaves first-slice invocation timeout observational. | Model this as an explicit lifecycle policy distinction, not as a Node capability difference. |
| Node supports some worker-safe addons; product policy fails closed absent established compatibility. | Treat documented eligibility as necessary, not sufficient, and require product-specific evidence before enabling worker mode. |

## Uncertainty and freshness

- Evidence is pinned to Node.js `v22.23.2`, accessed `2026-09-08T02:41:30-03:00`; later Node 22 patch releases may refine behavior or documentation.
- No runtime experiment, plugin, native addon, child process, loader, build, test, or packaged artifact was executed in this research.
- The documentation does not provide a hard upper bound for `terminate()`, rollback semantics, descendant-process cleanup, or a side-effect-free hostile-object validator.
- Exact environment keys, protocol schemas, byte/depth limits, error codes, diagnostic quotas, worker entry filename, loader policy, and shutdown ordering remain design tasks.
- The local statements are bounded source inspection of the listed files, not executed behavior.
- Native addon support is conditional and dependency-specific; no universal compatibility claim is valid.

## Evidence sufficiency

All eight selected questions have documentation-backed answers or explicitly documented evidence limits. The research outcome is `done` because the proposal can now state bounded guarantees, non-guarantees, defaults that contradict confirmed policies, and required design work without inventing product choices. `done` does not mean runtime feasibility or implementation behavior was experimentally proven.
