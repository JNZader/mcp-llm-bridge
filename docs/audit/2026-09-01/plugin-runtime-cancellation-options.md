# Dynamic plugin import cancellation: options and approval boundaries

True import cancellation requires an execution owner that can be stopped.
Replacing the current promise race alone cannot supply that guarantee while retaining live plugin functions.
This document proposes a compatibility package for discussion; **no implementation option has been approved**.

## Status and evidence

- Date: **2026-09-08**.
- Repository snapshot: **359b31fefb6f22dde8ba6c5a33a0ca1e742c11b3**.
- Latest production source delivery: **8db102a03ce2dfd7f5687f959ea1b2b4b26ac2e8**.
- Evidence consists of bounded source inspection and primary Node.js documentation.
- **No cancellation experiment, worker, child process, plugin or provider was executed for this investigation.**
- Existing containment test results are not cancellation evidence.
- This is a standalone research handoff, not an SDD artifact or implementation authorization.
- The historical WP00 ledger and six planning documents remain unchanged; RDD remains disabled.

For broader progress and existing evidence boundaries, see [WP00 current progress](wp00-progress-current.md).

## What the current implementation actually does

| Source and symbol | Observed behavior | Consequence |
|---|---|---|
| `src/mcp-builder/loader.ts:withTimeout` | Races an import promise against a timer and clears the timer afterward. | Settling the observer does not terminate the imported module. |
| `src/mcp-builder/loader.ts:loadPlugins` | Imports a shadow module, selects default/server/definition exports, validates and returns live definitions. | Moving initialization elsewhere must preserve the callable definitions without importing them again in the host. |
| `src/mcp-builder/loader.ts:loadPlugins` finally block | Removes the shadow file after each attempt. | File cleanup is not execution cancellation or rollback. |
| `src/mcp-builder/index.ts:ToolPattern,ToolHandler` | Tool definitions contain handlers; arguments use `Record<string, unknown>`. | Function closures need a persistent owner; TypeScript types do not enforce wire serializability. |
| `src/mcp-builder/index.ts:ResourcePattern,PromptPattern` | Resources and prompts also contain callable handlers. | Their presence in the definition type is not proof of production registration support. |
| `src/mcp-builder/adapter.ts:McpDefinitionAdapter.register` | Stores tool patterns and optionally registers tool callbacks on a supplied server. | Host registration must wrap isolated invocation rather than transfer original functions. |
| `src/mcp-builder/adapter.ts:executeTool` | Calls the retained handler directly and separately races invocation against a timer. | Import cancellation and invocation cancellation are different policies. |
| `src/server/mcp-server.ts:admitDynamicPlugins` | Checks tool collisions, registers admitted tools and security metadata. | These host checks must not be delegated to an untrusted plugin response. |
| `src/server/mcp-server.ts:startMcpServer` | Loads plugins before connecting stdio and returns the SDK server. | Failed startup must release any newly owned plugin runtimes. |
| `src/bootstrap/server-startup.ts:startDefaultMcpMode` | Awaits startup without retaining its returned server. | Runtime ownership and cleanup need explicit integration. |
| `src/bootstrap/shutdown.ts:setupGracefulShutdown` | Cleans existing services but has no plugin-runtime dependency. | Plugin shutdown cannot be assumed to follow current cleanup automatically. |
| `tsup.config.ts` | Declares `src/index.ts` as the build entry. | A separate runtime entry needs a deliberate packaging and resolution contract. |

The actual tool handler receives arguments only, not an injected Router, Vault or SDK server.
The adapter accepts a server for host-side registration; that object should not cross the proposed wire.
Current adapter registration covers tools only, despite resource/prompt definition types.
This proposal does not silently add resource or prompt support.

## Why a temporary importer is insufficient

A successful import can create functions that capture module state, caches and dependencies.
The host cannot obtain the same live closures by copying a serializable manifest.
Terminating a temporary importer after discovery would destroy the owner needed to execute those handlers.

Re-importing the plugin in the host is not an acceptable workaround:
- It would repeat initialization and its side effects.
- It would restore the uncancellable host execution boundary.
- It would not preserve the isolated module's state or function identity.

A useful isolated mode therefore needs persistent execution plus an explicit request/response protocol.

## Runtime reference and guarantee limits

Node documents that `worker.terminate()` stops worker JavaScript as soon as possible and returns a promise resolved on exit.
This is not a hard real-time deadline or rollback guarantee.
See [Node.js 22.23.2 worker termination](https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#workerterminate).

Worker data is cloned and cannot carry functions; native addons must meet worker compatibility requirements.
Constructor options also expose environment and stdio choices that require deliberate configuration.
See [Node.js 22.23.2 Worker constructor](https://nodejs.org/download/release/v22.23.2/docs/api/worker_threads.html#new-workerfilename-options).

These documented capabilities are not executed proof for this product.
A worker is **not an OS security sandbox**.
Spawned descendants, native I/O and external side effects are outside the proposed JavaScript-stop guarantee.
Effects completed before termination are not undone.

## Alternatives

| Option | Benefit | Cost and explicit limitation |
|---|---|---|
| Persistent worker per plugin with RPC | Retains module state while giving the host a terminable JavaScript owner. | Changes shared-global and serialization assumptions; worker failure affects all calls owned by that plugin. |
| Persistent child process per plugin with RPC | Gives each plugin a separate process lifecycle. | Higher startup/resource cost; requires IPC, environment, stdio, termination escalation and descendant policy. Process separation alone is not a complete sandbox. |
| Defer cancellation; retain timeout reporting | Preserves existing plugin execution compatibility. | Imports may continue after timeout; this does not satisfy true cancellation. |

Choosing an isolation mode changes observable plugin behavior.
None of these options is selected by the existence of this document.

## Proposed defaults — pending user approval

The following is one proposed package, not a collection of already accepted decisions:

1. Introduce a **persistent worker per plugin as an opt-in compatibility mode**.
2. Retain the legacy mode, clearly described as timeout reporting without cancellation.
3. Limit the first delivery to **import cancellation**, plus the stateful tool RPC needed to make successful imports usable.
4. Never re-import a worker-loaded plugin in the host.
5. Never fall back automatically to legacy execution when worker initialization or communication fails.
6. Design bounded serializable manifest, argument and result contracts before implementation.
7. Reject unsupported wire values with finite errors; do not silently drop fields or fabricate empty definitions.
8. Keep collision checks, security decisions and tool registration in the host.
9. Do not introduce resource/prompt execution as an incidental feature.
10. On crash or termination, settle every pending call exactly once; do not restart automatically.
11. In the first slice, invocation timeouts remain reported rather than triggering worker termination.
12. Require a separate policy before cancelling invocations or restarting stateful plugins.

No complete JSON schema, size limit, new error vocabulary or configuration key is invented here.
Those contracts require design and compatibility review after scope approval.

### Four decisions requiring approval

| Decision | Proposed direction | What remains to establish |
|---|---|---|
| Isolation and compatibility | Opt-in persistent workers; explicit legacy mode retained. | Environment exposure, stdout/stderr handling, native-addon compatibility, filesystem/network expectations and deployment support. |
| Serialization contract | Bounded manifest and tool request/result messages. | Supported values, exact schemas and limits, validation placement and finite unsupported-value errors. |
| Failure and shared state | Settle pending calls once; no automatic restart. | Effect on sibling tools/calls, quarantine and health projection, shutdown ordering and recovery initiated by the operator. |
| Cancellation scope | Import cancellation first; invocation timeout remains observational. | Timing policy, termination acknowledgement, pending-call behavior and any later invocation-cancellation policy. |

Environment, output and native-addon permissions are still design questions.
The proposed package does not approve access to real credentials, host configuration or external services.

## Coherent delivery slices after approval

| Slice | Deliverable boundary | Evidence needed before proceeding |
|---|---|---|
| Runtime wire and owner | Explicit bounded messages, worker entry and lifecycle ownership. | Initialization, malformed messages, termination acknowledgement and no host import. |
| Stateful tool RPC | Callable host wrappers backed by the persistent plugin owner. | Repeated stateful calls, supported arguments/results and unsupported-value rejection. |
| Host admission and shutdown | Existing security/collision behavior plus owned cleanup. | Startup failure, collision rejection, crash and shutdown release every runtime and pending call. |
| Packaged entry | Reliable runtime entry resolution outside the source checkout. | Distribution-layout fixture, supported runtime configuration and missing-entry failure. |
| Integrated verification | Approved compatibility and lifecycle behavior across slices. | Combined isolated probes and regressions, with scoped claims and recorded cleanup. |

These are proposed delivery boundaries, not executable tasks or completion checkboxes.
The complete change cannot responsibly be promised below 400 changed lines.
Actual tasks, dependencies and per-slice forecasts should be prepared after the decisions above.

## Future acceptance probes — not run

All probes must use isolated, owned fixtures with bounded parent timeouts and cleanup.
No actual plugin, credential, provider or user configuration is needed.

| Probe | Required observation |
|---|---|
| CPU-bound initialization | Host remains responsive and awaits the worker's termination acknowledgement. |
| Delayed marker after initialization timeout | No marker from plugin JavaScript appears after acknowledged termination within the declared observation window. |
| Stateful counter tool | Multiple successful calls use the same isolated state, not repeated imports. |
| Import-count marker | Exactly one initialization in the isolated owner and no host re-import. |
| Malformed or oversized message | Bounded rejection without partial admission or reflected diagnostic payloads. |
| Crash with pending calls | Every pending call settles once; no automatic restart or hanging promise. |
| Host shutdown and startup failure | Owned workers and listeners are released; repeated cleanup is well-defined. |
| Collision/security compatibility | Rejected tools are never delegated; existing filtering and authorization remain effective. |
| Packaged entry lookup | Distributed paths work without relying on TypeScript source files or checkout-specific locations. |
| Invocation timeout | Reports the approved timeout while explicitly not claiming invocation termination in the first slice. |

A passing delayed-marker probe would demonstrate only its stated window and JavaScript fixture.
It would not prove rollback, descendant termination, native-I/O cancellation or arbitrary sandbox safety.

## Relationship to WP00 and SDD

Opaque scanner-issued plugin/tool identity and immutable binding remain separate unresolved prerequisites.
Worker ownership does not create scanner authority or make filename hashes into admitted identities.
Existing plugin issue codes/messages and host security behavior remain compatibility inputs from:
`openspec/changes/containment-and-evidence-harness/design/contracts.md`.

An independent **optional SDD change** is worthwhile because the wire, lifecycle and compatibility decisions cross multiple modules.
Start it only after explicit user scope consent; do not reset, reuse or mark complete the old blocked ledger.
This research document creates no SDD lifecycle state and does not close ERR-PLUGIN or WP00.

## Next step

**Would you approve the proposed opt-in worker package as the scope for an independent design, or prefer the process-based or deferred option?**

Approval would authorize the next agreed design scope, not silently approve every unresolved permission or schema choice.
Until that decision, preserve the current runtime and treat cancellation as unimplemented.
