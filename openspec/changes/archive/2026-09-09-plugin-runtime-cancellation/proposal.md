# Proposal: Plugin Runtime Cancellation

## Intent

Stop timed-out plugin imports from continuing host initialization. Add an opt-in persistent worker per plugin while legacy loading stays default. Import timeout requests termination and settles after acknowledged exit, without stronger guarantees.

## Scope Decision

**Selective.** Deliver cancellable import ownership and stateful tool RPC. Defer invocation cancellation and broader containment because neither is required to stop timed-out imports.

## Scope

### In Scope
- Explicit worker mode, minimal environment allowlist, and no automatic legacy fallback.
- Strict bounded JSON manifests, arguments, results, request IDs, and diagnostics.
- Captured worker stdio with bounded host projection and no plugin bytes on MCP stdout.
- Host-owned admission, security, collisions, runtime registry, quarantine, shutdown, and single pending-call settlement.
- Import timeout termination with exit acknowledgement; observational invocation timeout without termination.

### Out of Scope
- OS sandboxing, hard real-time termination, rollback, descendant-process or native-I/O cancellation.
- Restart/replay, resources/prompts RPC, universal native-addon support, scanner identity redesign, or complete historical containment.

## Capabilities

### New Capabilities
- `plugin-runtime-cancellation`: Worker-owned import, stateful tool RPC, bounded wire/diagnostics, compatibility failure, and lifecycle settlement.

### Modified Capabilities
- None; `openspec/specs/` contains no existing capability to update.

## Approach

A persistent worker imports each plugin once, retains handlers, and emits a versioned bounded manifest. Host proxies invoke worker-owned handlers while admission, security, and collision authority stays host-side. Ownership transfers after admission. Terminal paths quarantine the plugin and settle pending calls once. Worker mode fails closed when native or deployed-entry compatibility is unestablished; users may explicitly select legacy mode.

## Affected Areas

| Area | Impact |
|---|---|
| `src/mcp-builder/{loader,adapter,index}.ts` | Separate manifests from worker-owned closures. |
| `src/server/mcp-server.ts`, `src/bootstrap/{server-startup,shutdown}.ts` | Preserve host authority; retain and close runtimes. |
| `src/mcp-builder/plugin-runtime*.ts` (proposed) | Add host, protocol, and worker entry. |
| `tsup.config.ts`, `package.json` | Publish the ESM worker entry. |

## Risks

- Exit acknowledgement neither reverses effects nor guarantees prompt termination.
- Worker failure affects sibling tools and shared state.
- Bounds may reject previously accepted values.
- Packaged or native-addon behavior remains unproven.

## Rollback Plan

Disable worker mode, remove its packaged entry, and retain unchanged legacy loading and host admission.

## Dependencies

- Node.js 22 worker lifecycle and packaged ESM support.
- Design definitions for limits, errors, allowlisted keys, and shutdown order.

## Success Criteria

- [ ] Timed-out import requests termination and settles after one observed worker exit.
- [ ] Sequential stateful calls run without host re-import.
- [ ] Failure/shutdown settles calls once, quarantines the plugin, and never restarts it.
- [ ] Oversized/non-JSON envelopes and diagnostics fail or truncate deterministically.
- [ ] Legacy stays default; unsupported worker deployments fail closed with explicit legacy selection.
