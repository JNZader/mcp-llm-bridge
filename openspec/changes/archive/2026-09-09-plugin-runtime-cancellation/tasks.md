# Tasks: Plugin Runtime Cancellation

## Review Workload Forecast

700–900 lines; approved size-exception; units <400.
400-line budget risk: High
Chained PRs recommended: Yes
Decision needed before apply: Yes
Delivery strategy: single-pr
Chain strategy: size-exception

One PR; four internal units; whole rollback. Test prefix T: node --import tsx --import ./test/setup/inject-require.mjs --test. Disposable Node 22.23.2; no host/CLI/provider/credentials.

### Suggested Work Units

| Unit / IDs | Estimate; dependency | Focused command | Harness; rollback |
|---|---|---|---|
| 1: 1.1→2.1→1.2→2.2 | +160/-45; none | T test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts | Synthetic fixtures; whole feature |
| 2: 1.3→2.3→2.4 | +190/-55; Unit 1 | T test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts | Synthetic worker; whole feature |
| 3: 1.4→3.1→3.2→3.3 | +220/-65; Units 1–2 | T test/mcp-builder/plugin-runtime-registry.test.ts test/mcp-builder/loader.test.ts test/bootstrap/plugin-runtime-lifecycle.test.ts | Hung/error/collision/sibling fixtures; whole feature |
| 4: 4.1→4.2 | +115/-35; Unit 3 | T test/e2e/plugin-runtime-package.test.ts | Installed package container; whole feature |



## Phase 1: RED Contracts (parallel by unit; precedes GREEN)

- [x] 1.1 RED: create `test/mcp-builder/plugin-runtime-config.test.ts` (new): gate/default/explicit mode, allowlist errors, compatibility-manifest missing/mismatch, explicit legacy fallback (R1 S1–2; R2 S3; R9 S20–21).
- [x] 1.2 RED: create `test/mcp-builder/plugin-runtime-protocol.test.ts` (new): closed envelopes/manifests/tools/security, JSON bounds, IDs, schemas, hostile getters/proxies, stable errors (R3 S5–7).
- [x] 1.3 RED: create `test/mcp-builder/plugin-runtime-worker.test.ts` (new) and `test/mcp-builder/plugin-runtime-diagnostics.test.ts` (new): closures/RPC, import/invocation timeouts, late results, quarantine, once-only settlement, siblings, 8 KiB/event, 64 KiB/lifetime, truncation counters, no MCP stdout (R2 S4; R4 S8–9; R6–8 S12–19).
- [x] 1.4 RED: create `test/mcp-builder/plugin-runtime-registry.test.ts` (new), `test/bootstrap/plugin-runtime-lifecycle.test.ts` (new), and `test/e2e/plugin-runtime-package.test.ts` (new): collision/handoff, cleanup, shutdown, ESM, compatibility evidence, stdout isolation (R5 S10–11; R9–10 S20–24). Git/commit/push/PR rows N/A.

## Phase 2: GREEN Foundation (follows RED)

- [x] 2.1 GREEN after 1.1: modify `src/core/mcp-runtime-config.ts`; parse allowlist/manifest and, before worker import/admission, validate Node major, platform, architecture, worker-entry hash, complete installed-plugin digest. Missing/mismatch returns COMPATIBILITY_UNESTABLISHED; legacy only explicit.
- [x] 2.2 GREEN after 1.2: create `src/mcp-builder/plugin-runtime-protocol.ts`; enforce closed bounded envelopes/manifests/security, JSON limits, IDs, payloads, stable errors.
- [x] 2.3 GREEN after 1.3: create `src/mcp-builder/plugin-runtime-worker.ts`; modify `tsup.config.ts` and `package.json` for packaged ESM, retained closures, bounded diagnostics, truncation, no MCP stdout.
- [x] 2.4 GREEN after 1.3/2.3: create `src/mcp-builder/plugin-runtime-host.ts`; implement state/finalizer, import exit acknowledgement, observational invocation timeout, quarantine, diagnostic cleanup.

## Phase 3: GREEN Ownership (sequential)

- [x] 3.1 GREEN after 1.4/2.2/2.4: create `src/mcp-builder/plugin-runtime-registry.ts`; modify `src/mcp-builder/loader.ts`, `src/mcp-builder/adapter.ts`, `src/mcp-builder/index.ts` for one-time handoff/proxies.
- [x] 3.2 GREEN after 3.1: modify `src/server/mcp-server.ts` and `src/server/mcp.ts`; retain host admission/security and reject reuse pre-admission.
- [x] 3.3 GREEN after 3.2: modify `src/bootstrap/runtime-context.ts`, `src/bootstrap/server-startup.ts`, `src/bootstrap/shutdown.ts`, `src/index.ts`; retain/close runtimes and order cleanup.

## Phase 4: Verification and Documentation

- [x] 4.1 Qualify fixed Node major/platform/architecture/worker-entry hash/complete installed-plugin digest in isolated raw worker (not admission); then write observed evidence to `test/e2e/results/plugin-runtime-acceptance.json` (new), run fail-closed production admission on tuple/mismatches; never self-issue evidence.
- [x] 4.2 Modify `docs/plugin-runtime-cancellation.md` (new) with config, allowlist, manifest, bounds, guarantees/non-goals, acceptance, rollback, deployment behavior.

## Requirement Coverage

R1 Legacy default/Explicit opt-in S1–2; R2 Environment isolation/Output bound S3–4; R3 Unknown envelope/Valid payload/Live values S5–7; R4 Closure persistence/RPC surface S8–9; R5 Collision/Handoff S10–11; R6 Pending termination/Intermediate error/Final exit S12–14; R7 Failure settlement/Sibling isolation/Late duplicate S15–17; R8 Worker remains alive/Late outcome S18–19; R9 Incompatible worker/Explicit legacy fallback S20–21; R10 Rejected startup/Shutdown/ESM artifact S22–24.
