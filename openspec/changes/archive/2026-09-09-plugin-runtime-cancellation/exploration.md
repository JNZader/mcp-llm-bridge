## Exploration: Plugin runtime cancellation

### Current State
Dynamic plugins are imported in the host process. `loadPlugins()` copies each module to a shadow path and races `import()` against a timer, but losing that race only settles the caller; it does not stop module initialization. A successful import returns definitions containing live handler closures, so terminating a temporary importer and re-importing in the host would lose state, repeat side effects, and restore the uncancellable boundary.

The adapter retains those closures and invokes tool handlers directly. Its invocation timeout is another `Promise.race`, so it reports timeout and updates per-tool quarantine state without stopping handler execution. The production admission path keeps collision checks, security registration, and MCP registration in the host. Although the definition model includes tools, resources, and prompts, the adapter registers tools only. Tool handlers receive only `Record<string, unknown>` arguments; host services and the MCP server are not injected into them.

Startup loads plugins before connecting stdio, but the returned server is discarded by the default bootstrap path and graceful shutdown has no plugin-runtime owner. Packaging exposes only `src/index.ts`, so an isolated runtime entry would need an explicit distribution contract. Existing tests verify bounded timeout reporting and quarantine behavior, not execution cancellation, termination acknowledgement, stateful cross-boundary calls, or packaged worker resolution.

The approved design scope is limited to an opt-in persistent worker per plugin, legacy behavior preserved as the default, true import cancellation first, and the stateful tool RPC required to keep worker-owned handlers usable. It does not authorize implementation or decide credentials/environment inheritance, stdio behavior, the detailed wire schema, native-addon support, or restart policy.

### Affected Areas
- `src/mcp-builder/loader.ts` — currently owns discovery, shadow imports, validation, and observational import timeouts; isolated mode needs a runtime owner rather than host `import()`.
- `src/mcp-builder/index.ts` — callable definitions mix serializable metadata with closures; isolated mode needs a separate manifest boundary while preserving tool-only initial scope.
- `src/mcp-builder/adapter.ts` — currently stores closures and executes them directly; worker mode needs host-side proxy handlers and must preserve existing safe results and quarantine semantics deliberately.
- `src/server/mcp-server.ts` — owns collision checks, security registration, admission, stdio connection, and startup failure handling; it must retain host authority and release rejected or failed runtimes.
- `src/bootstrap/server-startup.ts` — currently discards the server result, so it cannot expose plugin-runtime ownership for shutdown.
- `src/bootstrap/shutdown.ts` — has idempotent ordered cleanup but no plugin-runtime dependency or pending-call settlement step.
- `tsup.config.ts` — packages one entry only; a worker entry and its resolution from installed output are not yet defined.
- `test/mcp-builder/loader.test.ts` — timeout coverage proves bounded observation only; future isolated probes must prove acknowledged termination and no host re-import.
- `test/mcp-builder/adapter.test.ts` — current hanging-handler tests prove timeout/quarantine reporting, not termination; future coverage needs stateful RPC and single settlement of pending calls.
- `test/wp00/err-mcp-server.test.ts` — current MCP error coverage does not establish isolated runtime ownership, cleanup, or admission compatibility.

### Approaches
1. **Opt-in persistent worker per plugin** — import and retain each plugin inside one worker, return a validated manifest, and invoke its tool handlers by RPC.
   - Pros: Preserves plugin-local state and single initialization; gives the host a terminable JavaScript owner; lower lifecycle overhead than one process per plugin; matches the approved scope.
   - Cons: Requires bounded serialization, pending-call bookkeeping, crash/shutdown semantics, packaging, and explicit environment/stdio/native-addon compatibility; it is not an OS sandbox.
   - Effort: High

2. **Persistent child process per plugin** — retain the plugin in a separate process and call handlers over IPC.
   - Pros: Stronger process lifecycle boundary; can support process-level termination escalation and independent stdio.
   - Cons: Higher startup and memory cost; more complex IPC, environment, descendant, and shutdown policy; process separation is still not a complete sandbox and exceeds the approved worker scope.
   - Effort: High

3. **Legacy host import with timeout reporting** — keep the current `Promise.race` behavior and document that it is observational only.
   - Pros: Maximum compatibility and no new wire or runtime packaging contract.
   - Cons: Cannot provide true import cancellation; timed-out imports and handlers may continue running.
   - Effort: Low

### Recommendation
Proceed toward the approved opt-in persistent-worker design, with legacy host import remaining the default and with no automatic fallback from worker failure to legacy execution. Model the worker as the long-lived owner of both initialization and handler closures: the host receives only bounded metadata and registers proxy tools, while collision checks, security decisions, admission, and SDK registration remain host responsibilities. Resources and prompts should remain out of the first slice because current production registration is tool-only.

The proposal is not ready until the following product choices are confirmed as one consolidated decision envelope. Recommended options are recommendations, not inferred approval:

| Decision group | Options and consequences |
|---|---|
| **Configuration and environment** | **A. Explicit worker mode plus minimal environment allowlist (Recommended):** legacy remains default and credentials/config cross only when explicitly named; strongest containment, but plugins relying on ambient variables need migration. **B. Sanitized environment snapshot:** broader compatibility, but the sanitization contract becomes security-critical. **C. Full environment inheritance:** easiest compatibility, but exposes host credentials and configuration to worker plugins and weakens the value of opt-in isolation. The exact config key and precedence still need definition. |
| **Worker stdio and diagnostics** | **A. Isolated worker stdio with bounded host-projected diagnostics (Recommended):** prevents plugin output from corrupting MCP stdio and supports finite logging, but requires buffering/limits and a projection contract. **B. Discard worker stdout/stderr:** simplest protocol protection, but harms diagnosis. **C. Inherit host stdio:** easiest behavior preservation, but plugin writes can interfere with the stdio transport and leak content. |
| **Wire value contract** | **A. Strict bounded JSON-compatible manifest, arguments, and results (Recommended):** portable and auditable, with deterministic unsupported-value errors; may reject values currently accepted by in-process handlers. **B. Bounded structured-clone subset:** supports more native values, but adds cross-version/type semantics and validation complexity. **C. Unrestricted structured clone:** broadest convenience, but gives weak compatibility guarantees and makes limits/errors difficult to reason about. Exact schemas, byte/depth limits, validation sides, and error codes remain open. |
| **Failure, restart, and shared state** | **A. No automatic restart; quarantine the plugin and settle all pending calls exactly once (Recommended):** avoids replaying initialization or calls and preserves failure evidence, but requires operator-driven recovery. **B. One automatic worker restart without call replay:** improves availability but resets plugin state and repeats initialization side effects. **C. Restart and replay pending calls:** highest apparent availability, but can duplicate external effects and is unsafe without idempotency contracts. The effect on sibling tools and health projection still needs definition. |
| **Native addons and deployment compatibility** | **A. Worker mode fails closed when compatibility is not established; user may explicitly select legacy mode (Recommended):** honest guarantee boundary, but some plugins cannot use isolated mode. **B. Publish a tested compatibility subset:** better guidance, but requires a supported-platform matrix and ongoing verification. **C. Best-effort unrestricted support:** least migration friction, but failures become environment-dependent and cancellation claims are hard to qualify. |
| **Invocation timeout in the first slice** | **A. Keep it observational and do not terminate the worker (Recommended):** limits this change to import cancellation and stateful RPC, but timed-out handler code may continue and can affect sibling tools. **B. Terminate the worker on a timed-out invocation:** stronger stop behavior, but one call destroys shared plugin state and all sibling calls. **C. Disable invocation timeout in worker mode:** avoids misleading cancellation semantics, but permits indefinitely pending calls. Any later invocation-cancellation policy should be a separate decision. |

### Risks
- A worker termination acknowledgement is not a hard real-time deadline and cannot roll back effects completed before termination.
- A worker is not an OS sandbox; filesystem, network, native I/O, and spawned descendants need separately stated guarantee limits.
- Per-plugin ownership couples sibling tools: crash or termination can affect every pending call and all shared plugin state.
- Wire validation mistakes could admit oversized or non-serializable data, reflect untrusted diagnostics, or silently change existing tool results.
- Startup collision or security rejection can leak workers unless ownership transfers and cleanup are explicit and idempotent.
- MCP uses stdout for protocol transport, so inherited plugin output can corrupt framing unless stdio behavior is decided.
- A worker entry that works from TypeScript source may fail in the packaged distribution unless build output and URL resolution are tested.
- Legacy and worker modes can diverge observably; automatic fallback would hide the requested cancellation guarantee.
- Existing Node.js 22 documentation is source evidence, not a formal SDD research artifact or executed product proof.

### Ready for Proposal
No. The architectural direction and delivery scope are approved, but the orchestrator must obtain explicit answers to all six grouped product choices above before `sdd-propose`. A proposal must not invent credentials/environment access, stdio handling, detailed serialization limits, restart/state-loss behavior, native-addon support, or invocation-timeout consequences on the user's behalf.
