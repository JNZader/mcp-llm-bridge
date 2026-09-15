# Apply Progress: Plugin Runtime Cancellation

## Batch

- Work unit: Unit 1 (`1.1 → 2.1 → 1.2 → 2.2`)
- Authorization: explicit Unit 1-only implementation authorization is recorded in `state.yaml`; Units 2–4 remain unauthorized.
- Mode: Standard (`strict_tdd: false`), with the requested RED-before-GREEN sequence completed.
- Delivery: single PR, accepted `size:exception`; no commit, push, or PR was created.

## Historical Setup Blocker (Settled)

The first isolated setup attempt used `corepack prepare pnpm@9.15.9 --activate`, then failed at `pnpm install --frozen-lockfile` with exit `127` (`pnpm: not found`) before RED. Its owned container `9a0dc89e263f` and `/tmp/plugin-unit1-red.*` evidence were cleaned; the parent settled its native token as failed. This record is retained for history and was not retried. The authorized correction used the documented explicit-version Corepack invocation in a new container.

## Completed Tasks

- [x] 1.1 RED: added configuration contracts for the outer dynamic-server gate, defaults, invalid modes without secret-bearing diagnostics, environment allowlists, forbidden Node flags, worker compatibility mismatch, and explicit legacy selection.
- [x] 2.1 GREEN: added call-time worker configuration parsing, minimal allowlisted environment copying, and fail-closed compatibility tuple comparison before any future import/admission.
- [x] 1.2 RED: added protocol contracts for v1 closed envelopes/manifests/tools/security, numeric and encoded-byte bounds, JSON compatibility, accessors, and live request IDs.
- [x] 2.2 GREEN: added a stateless bounded protocol validator with stable error codes, closed schema checks, JSON limits, and duplicate live-ID rejection.

## Work Unit Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| In disposable container `plugin-unit1-green-2137417`, cwd `/work`: `node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts` → exit `0`; 10 tests passed, 0 failed, 0 cancelled, duration `553.377 ms`. Follow-up `./node_modules/.bin/tsc --noEmit` → exit `0`. | `node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.exec('select 1'); db.close();"` → exit `0`, proving the installed native ABI in the same isolated image. Unit 1 deliberately does not activate a worker, import a plugin, call a provider, or make sandbox/termination claims. | Revert `src/core/mcp-runtime-config.ts`, remove `src/mcp-builder/plugin-runtime-protocol.ts`, remove the two Unit 1 tests, and restore the four Unit 1 task checkboxes. This leaves Units 2–4 and unrelated containment work untouched. |

## Isolated Harness

- Image: `node@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d` (Node `22.23.2`).
- Bootstrap: `COREPACK_ENABLE_AUTO_PIN=0`; `corepack pnpm@9.15.9 --version` → `9.15.9`; `corepack pnpm@9.15.9 install --frozen-lockfile` → exit `0`; installed TypeScript check → `Version 5.9.3`.
- Isolation before test: `Networks={}` and `Mounts=[]`. The container received a tracked `HEAD` archive plus only the Unit 1 test/source overlays; no host `.git`, `.env`, or `node_modules` was mounted or copied.

## Remaining Tasks

9 of 13 tasks remain pending: Unit 2 (`1.3`, `2.3`, `2.4`), Unit 3 (`1.4`, `3.1`, `3.2`, `3.3`), and Unit 4 (`4.1`, `4.2`). They remain outside this authorization.

## Unit 2 Partial Attempt (Blocked)

- Work unit: Unit 2 (`1.3 → 2.3 → 2.4`), explicitly authorized in `state.yaml`; Units 3–4 remain unauthorized.
- RED test sources were written before production: `test/mcp-builder/plugin-runtime-worker.test.ts` and `test/mcp-builder/plugin-runtime-diagnostics.test.ts`. No Unit 2 production source was created, no task checkbox was changed, and no RED assertions ran.
- The disposable Node 22 harness bootstrap completed, but its zsh wrapper failed before the focused command because `status` is a read-only zsh parameter. This is harness-wrapper evidence, not a test result and not a source failure.

### Unit 2 Attempt Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| Intended command in disposable container cwd `/work`: `node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts`. **Not executed**: the wrapper stopped at `status=$?` with `zsh: read-only variable: status` before it invoked the command. | Bootstrap evidence in owned disposable `plugin-unit2-red-1788904316`: `corepack pnpm@9.15.9 --version` → `9.15.9`; frozen install → exit `0`; Node `v22.23.2`; TypeScript `Version 5.9.3`; `better-sqlite3` in-memory probe → exit `0`; then `Networks={}` and `Mounts=[]`. The owned container was removed and a matching `docker ps -a --filter name=plugin-unit2-red-` query returned no rows. | Remove the two unexecuted Unit 2 RED test files and restore this partial-attempt section if abandoning the work unit. No production code or task checkbox needs rollback. |

## Remaining Tasks

9 of 13 tasks remain pending: Unit 2 (`1.3`, `2.3`, `2.4`), Unit 3 (`1.4`, `3.1`, `3.2`, `3.3`), and Unit 4 (`4.1`, `4.2`). Unit 2 is authorized but blocked pending a newly acquired continuation with a corrected harness wrapper; Units 3–4 remain outside authorization.

## Unit 2 Corrected Retry (Partial)

- The corrected `exit_code` wrapper executed the intentionally failing RED command in a disposable container, cwd `/work`: exit `1`, 0 passed / 4 failed, duration `181.129245 ms`; every failure was an intentional assertion failure, not a missing-file failure.
- After source and test edits, the final disconnected-container command covering Unit 1 and Unit 2 tests exited `0`: 12 passed, 0 failed, 0 cancelled, duration `260.702974 ms`. `./node_modules/.bin/tsc --noEmit` exited `0`.
- The harness created a production worker dispatcher, a host with bounded diagnostic projection and observational invocation timeout behavior, and added the worker entry to the tsup entry list. However, the required import-deadline termination/observed-exit lifecycle is not exercised by the final tests, and the packaged worker remains inert pending the later loader/registry ownership unit. Therefore 1.3, 2.3, and 2.4 remain unchecked; this retry is not a completion claim.

### Corrected Retry Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| In disposable container `plugin-unit2-retry-1788905766`, cwd `/work`: `node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts` → exit `0`; 12 passed, 0 failed, 0 cancelled, duration `260.702974 ms`. `./node_modules/.bin/tsc --noEmit` → exit `0`. | The same owned Node `22.23.2` container used versioned Corepack `9.15.9`, frozen install, TypeScript `5.9.3`, and a `better-sqlite3` in-memory ABI probe before network disconnect. Before RED, `Networks={}` and `Mounts=[]`. Final tests used controlled in-process synthetic ports/workers; they prove neither packaged ESM acceptance nor import timeout exit acknowledgement. The container and owned temporary artifacts were removed; matching `docker ps -a --filter name=plugin-unit2-retry-` returned no rows. | Remove `src/mcp-builder/plugin-runtime-worker.ts`, `src/mcp-builder/plugin-runtime-host.ts`, the two Unit 2 test files, and the worker tsup entry; then restore this retry section and leave Unit 1 untouched. |

## Remaining Tasks

9 of 13 tasks remain pending: Unit 2 (`1.3`, `2.3`, `2.4`), Unit 3 (`1.4`, `3.1`, `3.2`, `3.3`), and Unit 4 (`4.1`, `4.2`). Unit 2 needs a bounded corrective completion with real worker/import-exit test coverage before its checkboxes may be marked.

## Unit 2 Corrective Completion Attempt (Blocked Before Applicable RED)

- Work unit: Unit 2 (`1.3 → 2.3 → 2.4`), expressly authorized; Units 3–4 remain outside scope.
- The Unit 2 test sources were replaced before any production edit to require a real `node:worker_threads` Worker executing a test-emitted production ESM worker entry with `execArgv: []`. They cover persistent closures, observational timeouts, import deadline/observed exit, real stdio bounds, and controlled error-before-exit ordering.
- The one permitted RED command was run on the host by mistake rather than the mandatory disposable Node 22 container. It exited `1` before test discovery because Node `v25.8.1` could not resolve the undeclared/transitive `esbuild` package used by the new test harness (`ERR_MODULE_NOT_FOUND`). This is an unexpected harness dependency failure, not an assertion-level RED result and not a production-source failure. Per the work packet, no implementation, normalization, GREEN, typecheck, task completion, or retry followed.

### Corrective Attempt Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| Host cwd `/home/javier/programacion/mcp-llm-bridge-wt-wp00`: `node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts` → exit `1`; 0 passed, 2 failed, duration `518.06157 ms`. Both files failed before discovery with `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`; this command is invalid as acceptance evidence because it violated the container-only runtime rule. | **Not run.** The required owned Node 22.23.2 disconnected-container lifecycle was not launched after the unexpected host harness failure. No container, mount, network, temporary runtime directory, production entry acceptance, or native ABI claim was created. | Restore the two Unit 2 test files to their preceding state and remove this section if abandoning this corrective packet. `tasks.md`, production sources, `tsup.config.ts`, `package.json`, and Unit 1 remain unchanged by this attempt. |

## Remaining Tasks

9 of 13 tasks remain pending: Unit 2 (`1.3`, `2.3`, `2.4`), Unit 3 (`1.4`, `3.1`, `3.2`, `3.3`), and Unit 4 (`4.1`, `4.2`). No Unit 2 checkbox changed because applicable real-worker RED/GREEN/container evidence was not obtained.

## Unit 2 Isolated Runtime Proof With Typecheck Blocker (Partial)

- Work unit: Unit 2 (`1.3 → 2.3 → 2.4`), explicitly authorized; Units 3–4 remain unauthorized.
- The real-worker RED gate ran first in the isolated Node `22.23.2` container and exited `1` with 7 failed tests in 2 suites. Its failures were applicable constructor/deadline assertions: the production host factory was missing and startup ignored the configured deadline.
- After the one authorized implementation pass, the isolated real-worker GREEN suite passed: 17 passed, 0 failed, 0 skipped, 0 cancelled across 4 suites in `1046.438528 ms`, exit `0`. This exercises the test-emitted production ESM worker, persistent closures, correlated RPC failures, observational timeout, import termination after observed exit, sibling quarantine, worker factory isolation, and bounded stdout/stderr projection.
- Completion is blocked because conditional typecheck exited `2`. It reported `src/mcp-builder/plugin-runtime-host.ts:5:3 TS6133` (unused `PLUGIN_RUNTIME_ERROR`) and `src/mcp-builder/plugin-runtime-worker.ts:164:65`, `:165:32 TS2345` (nullable `parentPort` passed as `PluginRuntimePort`). No retry or source correction is authorized under the exhausted attempt.
- Tasks `1.3`, `2.3`, and `2.4` remain unchecked. Cumulative progress remains **4 of 13 complete; 9 pending**.

### Unit 2 Failed Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| In isolated container `plugin-unit2-final-20260908`, cwd `/work`: `node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts` → exit `0`; 17 passed, 0 failed, 0 skipped, 0 cancelled, 4 suites, `1046.438528 ms`. Conditional `./node_modules/.bin/tsc --noEmit` → exit `2`; see the exact compiler diagnostics above. | RED: isolated command covering the two Unit 2 tests → exit `1`; 7 failed / 0 passed in 2 suites, with constructor/deadline failures. GREEN: test-emitted production ESM entry in the same isolated Node `22.23.2` container exercised real `node:worker_threads` lifecycle and diagnostics → exit `0`. Container `plugin-unit2-final-20260908` ID `42cac9c2f14c1778c037df8fa24832102ab8fb8115a1e5c466e52da4d9fe6bbb`, `Mounts=[]`, `Networks={}`; retained for the next authorized correction. GREEN log SHA-256 `2e605660815422ba96bcd936ce13999bdb40d7aceb5b66534bad5cfbbc988187`; typecheck log SHA-256 `f97c97ef5d563e733e42417ed700005286a850036e5fdefa55fb754a7e967668`. | Revert only `src/mcp-builder/plugin-runtime-worker.ts`, `src/mcp-builder/plugin-runtime-host.ts`, `test/mcp-builder/plugin-runtime-worker.test.ts`, `test/mcp-builder/plugin-runtime-diagnostics.test.ts`, and `test/mcp-builder/fixtures/plugin-runtime/emit-runtime-worker.ts`; retain Unit 1 and the pre-existing worker tsup entry. Do not change Unit 2 task checkboxes unless a later authorized correction obtains both runtime and typecheck proof. |

## Unit 2 TypeScript Correction and Completion

- Work unit: Unit 2 (`1.3 → 2.3 → 2.4`), authorized by the bounded corrective attempt; Units 3–4 remain unauthorized.
- Correction scope: only the three compiler diagnostics from the preceding partial attempt. `plugin-runtime-host.ts` no longer imports unused `PLUGIN_RUNTIME_ERROR`; `plugin-runtime-worker.ts` captures the already-validated non-null `parentPort` in `port` for asynchronous closures. No test, API, or runtime semantic change was made in this correction.
- The retained isolated Node `22.23.2` worker proof passed after correction: 17 passed, 0 failed, 0 skipped, 0 cancelled across 4 suites in `1357.166467 ms`, exit `0`. Conditional typecheck also exited `0` with no diagnostics.
- Tasks `1.3`, `2.3`, and `2.4` are now complete. Cumulative progress is **7 of 13 complete; 6 pending**. This proves Unit 2 only; it is not full SDD verification or installed-package acceptance.

### Unit 2 Completion Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| In isolated retained container `plugin-unit2-final-20260908`, cwd `/work`: `timeout 120s node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts` → exit `0`; 17 passed, 0 failed, 0 skipped, 0 cancelled, 4 suites, `1357.166467 ms`. In the same container and cwd: `./node_modules/.bin/tsc --noEmit` → exit `0`, no diagnostics. | The test-emitted production ESM entry ran with real `node:worker_threads` lifecycle: closure retention, correlated malformed RPC failure, observational timeout with ignored late result, import termination after observed exit, sibling quarantine, factory env/argv/execArgv isolation, and bounded stdout/stderr projection. Container ID `42cac9c2f14c1778c037df8fa24832102ab8fb8115a1e5c466e52da4d9fe6bbb`; `Mounts=[]`, `Networks={}`. GREEN log SHA-256 `0237d3a182f3fed14398abe9aa6c4e3c5749304d7d106b0ca7b8d25d1dc63cfb`; empty successful typecheck log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. | Revert `src/mcp-builder/plugin-runtime-worker.ts`, `src/mcp-builder/plugin-runtime-host.ts`, `test/mcp-builder/plugin-runtime-worker.test.ts`, `test/mcp-builder/plugin-runtime-diagnostics.test.ts`, and `test/mcp-builder/fixtures/plugin-runtime/emit-runtime-worker.ts`; restore Unit 2 checkboxes. Leave Unit 1, Units 3–4, and pre-existing tsup entry work untouched. |

## Unit 3 RED Authoring Gate Interrupted

- Unit 3 authorization and three RED artifacts were recorded, but the RED artifact gate failed twice before any executor runtime command.
- The initial contracts incorrectly required a worker registry for default legacy `loadPlugins` behavior and expected propagation without injecting an owner. The corrected contracts still omitted missing-security, collision cleanup/sibling isolation, startup/connect cleanup, observed-exit waiting, and observational-timeout cases.
- `test/e2e/plugin-runtime-package.test.ts` is an empty `describe.skip` placeholder. It supplies neither an executable package contract nor qualification evidence.
- This is inspection evidence, not a test/runtime failure: **0 runtime commands, 0 production changes, 0 new completed tasks**. Tasks remain **7 of 13 complete; 6 pending**. Unit 4 remains unrun.

## Unit 3 Source Implementation Pending GREEN Proof

- Work unit: Unit 3 (`1.4 → 3.1 → 3.2 → 3.3`); Standard mode (`strict_tdd: false`), with applicable RED evidence executed by the parent-owned isolated harness.
- Source changes add the runtime registry, worker-mode pre-import gate, retained registry ownership through startup, and registry-first idempotent shutdown.
- No Unit 3 task checkbox is marked complete: focused GREEN, bootstrap regressions, and typecheck remain parent-owned proof obligations.
- Worker mode remains fail-closed until Unit 4 supplies externally observed installed-package compatibility evidence; this source pass neither computes nor self-issues acceptance evidence.

### Unit 3 Pending Proof

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| **Not run by this source-only writer.** Parent-owned isolated GREEN command: `node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-registry.test.ts test/mcp-builder/loader.test.ts test/bootstrap/plugin-runtime-lifecycle.test.ts test/e2e/plugin-runtime-package.test.ts`, followed by targeted regressions and `tsc --noEmit`. | **Not run by this source-only writer.** Unit 2 remains the only real-worker lifecycle proof; Unit 4 remains the installed-package acceptance boundary. | Revert `src/mcp-builder/plugin-runtime-registry.ts`, the Unit 3 edits to loader/server/bootstrap/index, and the compatible bootstrap stub updates; retain Unit 1/2 sources, tests, and all unchecked task state. |

## Unit 3 GREEN Attempt (Failed; Bookkeeping Only)

- Work unit: Unit 3 (`1.4 → 3.1 → 3.2 → 3.3`); Standard mode (`strict_tdd: false`). Unit 3 remains incomplete: cumulative progress is **7 of 13 complete; 6 pending**. No task checkbox changed.
- [executed] In retained isolated container `plugin-unit2-final-20260908`, cwd `/work`, the applicable RED command exited `1`: 25 tests across 4 suites; 16 passed, 9 failed, 0 cancelled, 0 skipped, 0 todo; duration `2339.852374 ms`. Eight failures were applicable Unit 3 assertions. The ninth was a stale container `tsup` overlay, corrected by copying the actual host configuration before GREEN; it was not a repository defect. RED log: `/tmp/unit3-red-20260909.log`, SHA-256 `695b11a85ed28af7bce7dc14541167147df6cba48f24cb7afdf7a822aa0866a5`.
- [executed] The parent-owned isolated GREEN command exited `1`: 64 tests across 12 suites; 59 passed, 5 failed, 0 cancelled, 0 skipped, 0 todo; duration `2197.927321 ms`. The 11 non-adapter suites, including the new registry and lifecycle contracts, passed. GREEN log: `/tmp/unit3-green-20260909.log`, SHA-256 `06d838982154d577d3a175a9eec698c7cbf53688aac58fa462c6a6ce870bfe55`.
- [executed] The exact GREEN command was `timeout 120s node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-registry.test.ts test/mcp-builder/loader.test.ts test/bootstrap/plugin-runtime-lifecycle.test.ts test/e2e/plugin-runtime-package.test.ts test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts test/mcp-builder/adapter.test.ts test/bootstrap/server-startup.test.ts test/bootstrap/shutdown.test.ts test/bootstrap/runtime-context.test.ts`.
- [read] Conditional `tsc --noEmit` was **not run** because the focused GREEN command failed. This is neither full SDD verification nor installed-package acceptance.
- [executed] All five GREEN failures are legacy adapter expectations: `adapter.test.ts:112` expected raw `boom` plus tool/plugin metadata instead of a sanitized generic error; `:159` expected tool/plugin/timeout details instead of a generic timeout; `:210` and `:264` expected tool/plugin/failure-count details instead of generic quarantine; `:308` expected a present `lastErrorMessage: undefined` property rather than omission.
- [inferred] Parent read-only comparison `b7f5f1` found the adapter test unchanged and `HEAD` already returns sanitized generic errors while omitting `lastErrorMessage`; this indicates pre-existing expectation drift, not an executed baseline comparison. The Unit 3 diff only adds worker-proxy registration/branching. Do not restore raw error or plugin metadata leakage solely to satisfy these stale expectations.
- [read] Remaining integration follow-ups from read-only inspections `1a5f8c` and `afebf9` are not runtime-validated: rejected worker loading currently rethrows the first plugin error and outer server cleanup may close healthy siblings; host construction omits `invocationTimeoutMs` so the existing host default is `50 ms` rather than the configured legacy tool default `10000 ms`; successful fallback-registry lifecycle cleanup is not visibly wired at the inspected `return server` path; admission/handoff ordering and types still need verification. The real installed worker path with a valid external compatibility manifest was not executed. Package prequalification only; Unit 4 remains pending.
- [executed] The attempt was settled as failed under `a60eae` with evidence revision `sha256:06d838982154d577d3a175a9eec698c7cbf53688aac58fa462c6a6ce870bfe55`; native state is `blocked`, reason `maintainer_decision`. This secondary governance state was not the cause of the test failure. No caller-owned counters were persisted.
- [read] Isolation evidence: container `42cac9c2f14c1778c037df8fa24832102ab8fb8115a1e5c466e52da4d9fe6bbb`, Node `22.23.2`, `Mounts=[]`, `Networks={}`; 11 overlays and 4 RED hashes matched. The process ended and the container is retained idle with logs. No host runtime, commit, push, or PR occurred.

### Unit 3 Failed GREEN Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| [executed] In `plugin-unit2-final-20260908`, cwd `/work`, the 12-suite command recorded above exited `1`: 64 tests, 59 passed, 5 failed, duration `2197.927321 ms`; `tsc --noEmit` was not run after this failure. | [executed] Isolated Node `22.23.2` container with no mounts or network; the process ended and the retained container is idle. This attempt did not execute a worker under a valid installed compatibility manifest and supplies no installed-package acceptance proof. | Revert only Unit 3 registry/loader/adapter/server/bootstrap/index wiring and Unit 3 tests/stubs; retain Units 1–2, all existing completed checkbox state, and unrelated containment changes. |

## Remaining Tasks

6 of 13 tasks remain pending: Unit 3 (`1.4`, `3.1`, `3.2`, `3.3`) and Unit 4 (`4.1`, `4.2`). Unit 3 is blocked pending a maintainer decision on the failed GREEN evidence and the recorded integration follow-ups; Unit 4 has not run.

## Unit 3 Corrective Source Pass (Pending Independent Proof)

- [read] Authorized corrective scope addressed the recorded inspection follow-ups without changing task checkboxes. `loadWorkerPlugins` now records a rejected plugin as a per-plugin load error after awaited host shutdown, allowing already admitted healthy siblings to remain live; global compatibility configuration still throws before any plugin import.
- [read] Worker host construction now passes `dynamicPluginToolTimeoutMs()` as `invocationTimeoutMs`; the worker proxy remains outside the legacy adapter timeout/quarantine wrapper.
- [read] `startMcpServer` now distinguishes legacy and worker loader summaries without an unsafe union cast and wraps successful `server.close()` so the injected or fallback registry closes exactly once before the original close operation. Existing failure cleanup remains in the startup catch path.
- [read] Adapter regression expectations now assert the established sanitized generic payloads and omission of raw error/plugin metadata rather than restoring data leakage.
- **Not executed by this source-only writer.** Parent-owned isolated runtime and TypeScript proof remain required. No Unit 3 checkbox changed; cumulative state remains 7 of 13 complete and 6 pending. Unit 4 installed-package qualification remains deferred.
- [read] Corrective regression added in `plugin-runtime-registry.test.ts`: it executes the actual `loadWorkerPlugins` control flow through injected observation/runtime seams, asserts configured `37 ms` invocation forwarding, awaits rejected `broken` host cleanup, records one load error, and verifies the admitted `legacy` sibling remains invokable. It is pending parent-owned execution.

## Unit 3 Direct Server Lifecycle Regression (Pending Parent Proof)

- [read] Added direct `startMcpServer` lifecycle contracts using inert dependencies, `MCP_DYNAMIC_SERVERS=false`, and scoped SDK/registry prototype mocks restored in each test's `finally` block. They do not create a real stdio connection.
- [read] The injected-registry contract delays `closeAll()`, invokes `server.close()` twice, and requires the delayed registry close to finish before the captured original SDK close (`test/bootstrap/plugin-runtime-lifecycle.test.ts`).
- [read] The fallback-registry contract observes the internally created `PluginRuntimeRegistry` through its scoped prototype mock and enforces the same once-only, registry-before-SDK close ordering.
- [read] The connection-rejection contract calls actual `startMcpServer`, delays injected registry cleanup, and requires cleanup acknowledgement before the SDK connection rejection is exposed.
- **Not executed by this source-only writer.** Parent-owned isolated runtime test and TypeScript proof are still required. No Unit 3 task checkbox changed; cumulative task state remains **7 of 13 complete; 6 pending**.

### Pending Parent Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| **Not run by this source-only writer.** Parent-owned focused command must include `test/bootstrap/plugin-runtime-lifecycle.test.ts`; source readback only verified `git diff --check --no-index /dev/null test/bootstrap/plugin-runtime-lifecycle.test.ts` → exit `0`. | **Not run by this source-only writer.** The three direct actual-`startMcpServer` contracts require parent-owned isolated execution before completion can be claimed. | Revert the direct lifecycle additions in `test/bootstrap/plugin-runtime-lifecycle.test.ts`; no production seam or task checkbox was changed by this source-only pass. |

## Unit 3 Rejected-Host Cleanup and Fixture Type Correction (Pending Parent Proof)

- [executed] Parent-owned isolated proof immediately before this correction ran 68 tests across 12 suites: 67 passed, 1 failed (`test/mcp-builder/plugin-runtime-registry.test.ts:326` expected `['close:broken']`, received two entries); duration `2882.880183 ms`. Its log SHA-256 is `7f0f2e859ad7953940a7641c87f5f69b3b6965d5411881f427cad9a9796e91e2`.
- [executed] The parent-owned TypeScript command then reported 7 fixture diagnostics: lifecycle registry-owner/service/HTTP-stub mismatches at former lines 16, 36, 37, 64, 79, and 87, plus the loader `createRuntime().start()` manifest security mismatch at registry-test former line 310. Its log SHA-256 is `69ad595480fc09f59a448ce5942a281b2747376686329f903ab44a095e07de09`.
- [read] `loadWorkerPlugins` now creates one shared `closeHost()` promise per host. Both the transferred registry handle and the loader failure catch await it, including a synchronous `shutdown()` throw represented as a rejected promise, so rejected admission cannot execute cleanup twice.
- [read] Lifecycle fixtures now use concrete `PluginRuntimeRegistry` instances with scoped per-instance `closeAll` mocks restored in `finally`; shutdown dependencies and service fields use their concrete required types without broad double casts.
- [read] Registry fixture valid manifests now use `PluginRuntimeManifest`, `PluginRuntimeToolManifest`, and `PluginRuntimeSecurity` from the production protocol. Missing/invalid security remains explicitly modelled only for rejection candidates.
- **Not executed by this source-only writer.** Parent must rerun the same isolated 68-test command and TypeScript check before any Unit 3 task checkbox changes. Cumulative task state remains **7 of 13 complete; 6 pending**.

### Pending Parent Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| **Not run by this source-only writer.** Source-only checks: `git diff --check` for `src/mcp-builder/loader.ts` and `git diff --check --no-index /dev/null` for both edited test files → exit `0`. | **Not run by this source-only writer.** Re-run the existing isolated 68-test suite and `tsc --noEmit`; this correction makes no package, compatibility, or Unit 4 acceptance claim. | Revert the shared `closeHost` memoization in `src/mcp-builder/loader.ts` and the fixture-only type corrections in the two Unit 3 test files; retain all prior Unit 1–2 work and unchecked Unit 3 state. |


## Unit 3 Completion (Accepted Isolated Proof)

- [executed] The corrected Unit 3 isolated suite completed in container `plugin-unit2-final-20260908` (ID `42cac9c2f14c1778c037df8fa24832102ab8fb8115a1e5c466e52da4d9fe6bbb`), cwd `/work`, Node `22.23.2`: `timeout 120s node --import tsx --import ./test/setup/inject-require.mjs --test test/mcp-builder/plugin-runtime-registry.test.ts test/mcp-builder/loader.test.ts test/bootstrap/plugin-runtime-lifecycle.test.ts test/e2e/plugin-runtime-package.test.ts test/mcp-builder/plugin-runtime-worker.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts test/mcp-builder/plugin-runtime-config.test.ts test/mcp-builder/plugin-runtime-protocol.test.ts test/mcp-builder/adapter.test.ts test/bootstrap/server-startup.test.ts test/bootstrap/shutdown.test.ts test/bootstrap/runtime-context.test.ts` → exit `0`; 68 passed, 0 failed, skipped, cancelled, or todo across 12 suites; duration `1435.891514 ms`. Log SHA-256: `f63d20e938035a81fd203bb0ae0978da804d9fc15b5d7116138ae5c048c63151`.
- [executed] In the same container and cwd, `./node_modules/.bin/tsc --noEmit` → exit `0` with no diagnostics. Typecheck log SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; TypeScript `5.9.3`.
- [executed] The isolated proof preserved `Mounts=[]`, `Networks={}`, and only the `sleep infinity` process remained; 27 tracked proof-input hashes matched before and after execution.
- [read] Fresh `unit3_contract_check` accepted all four Unit 3 work items (4/4 eligible) from the accepted isolated evidence and named coverage. It was an artifact contract check, not a diff review or additional runtime execution.
- [read] The accepted correction memoizes `closeHost()` across rejected registry admission and loader catch cleanup; concrete lifecycle fixtures and production protocol manifest types preserve the direct assertions without weakening them.
- Tasks `1.4`, `3.1`, `3.2`, and `3.3` are complete. Cumulative state is **11 of 13 complete; 2 pending**: Unit 4 (`4.1`, `4.2`).

### Scope Boundary

Unit 3 is complete from its isolated test and TypeScript evidence only. This is **not** full SDD verification and supplies no installed-package qualification. The `1.4` package portion is source/prequalification authoring plus reused Unit 2 ESM/stdout coverage; installed tuple qualification and observed acceptance evidence remain exclusively in Unit 4.

### Unit 3 Completion Evidence

| Focused command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|
| Isolated `/work` command above → exit `0`; 68/68 passed, 12 suites, `1435.891514 ms`; `tsc --noEmit` → exit `0`. | Node `22.23.2` / TypeScript `5.9.3`; container `plugin-unit2-final-20260908`; no mounts or networks; only `sleep infinity` remained; 27 hashes matched. | Revert Unit 3 registry/loader/adapter/server/bootstrap/index wiring and Unit 3 tests/fixtures, then restore checkboxes `1.4`, `3.1`, `3.2`, `3.3`; retain completed Units 1–2 and pending Unit 4. |


## Unit 4 RED Authoring (Pending Parent Build/Pack Execution)

- [read] Unit 4 authorization now covers `4.1` and `4.2`; source-only RED additions preserve the existing **11 of 13 complete** task state.
- [read] `plugin-runtime-package.test.ts` keeps both source prequalification tests and conditionally registers installed qualification only when `PLUGIN_PACKAGE_ROOT` is explicitly supplied. Its first installed assertion requires emitted `dist/loader.js`, `dist/plugin-runtime-host.js`, `dist/plugin-runtime-registry.js`, and `dist/plugin-runtime-worker.js` before any installed imports.
- [read] Installed contracts use actual emitted worker, host/registry/loader modules with no loader observation/runtime seams: raw worker state/stdio/argv/execArgv coverage precedes independently observed tuple admission, missing-manifest and five tuple mismatch rejection, and generated acceptance output only after all checks succeed.
- [read] Diagnostics now require the conservative 64 KiB combined stdout/stderr lifetime bound in addition to the existing per-event/per-stream assertions. Current production records 64 KiB per stream, so this is intentional RED coverage.
- **Not executed by this source-only writer.** Parent must build and pack the installed fixture, set explicit package-root/output environment variables, and run the bounded RED harness before production or package changes. No acceptance JSON was written.

### Pending Parent RED Environment

- `PLUGIN_PACKAGE_ROOT`: isolated installed package fixture root.
- `PLUGIN_ACCEPTANCE_OUTPUT`: container-local output path outside the package root; absent during baseline missing-entry RED.
- Entry command: `node --import tsx --import ./test/setup/inject-require.mjs --test test/e2e/plugin-runtime-package.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts`.

### Rollback Boundary

Remove the Unit 4 additions in `test/e2e/plugin-runtime-package.test.ts` and `test/mcp-builder/plugin-runtime-diagnostics.test.ts`, then restore this section and the Unit 4 authorization record. Retain Units 1–3 and leave tasks `4.1` and `4.2` unchecked.

## Unit 4 Source Gate Correction (Pending Parent Build/Pack Execution)

- [read] The installed qualification contract is one guarded transaction after its separate no-import entry assertion. It creates one temporary built-in-only ESM fixture root outside the installed package, computes the five-field tuple over that immutable root and emitted worker before raw qualification, re-observes the same digest after raw and hung-import paths, then uses the original tuple for missing-manifest, each valid mismatch, and matching installed admission.
- [read] Raw qualification uses the installed `PluginRuntimeHost` around actual `node:worker_threads` Workers. The small worker factory wrapper records only launch values and real `exit` events; it asserts empty environment/argv/execArgv for the raw worker, while the plugin independently reports its retained closure state, environment keys, argv, and execArgv. The parent-only canary is set only around raw invocation.
- [read] The same fixture has a controlled hung-import branch. The test awaits the real worker exit before asserting `IMPORT_TIMEOUT`; it has no sleep or polling proof. All host, registry, worker, fixture, marker, and bounded diagnostic-watchdog cleanup is in `finally`.
- [read] The raw fixture emits more than 64 KiB on both worker streams. It asserts installed-host 8 KiB events, drops/truncation, bounded aggregate captured output, and absence of the trailing raw stdout sentinel from diagnostic projection. The separate diagnostics suite retains the conservative aggregate 64 KiB assertion-level RED requirement.
- [read] The acceptance JSON is outside the digested fixture root and is written only after raw qualification, frozen-byte re-observation, all six failure admissions, matching admission/invocation, and final digest assertion. Its checks list only these executed-by-test assertions and states the built-in-only scope; no output is created by this source-only authoring pass.
- **Not executed by this source-only writer.** This correction is source authoring only, not a new runtime attempt, production change, package build, qualification result, or Unit 4 completion. Tasks remain **11 of 13 complete**; `4.1` and `4.2` remain unchecked pending the parent-owned isolated build/pack RED path.

### Pending Parent RED Environment

- `PLUGIN_PACKAGE_ROOT`: isolated installed package fixture root; first run against the current package should fail the no-import entry assertion for missing loader/host/registry entries.
- `PLUGIN_ACCEPTANCE_OUTPUT`: container-local output path outside the closed fixture root; no file may appear unless the one guarded transaction reaches its final write.
- Entry command: `node --import tsx --import ./test/setup/inject-require.mjs --test test/e2e/plugin-runtime-package.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts`.

### Rollback Boundary

Revert the Unit 4 additions in `test/e2e/plugin-runtime-package.test.ts` and `test/mcp-builder/plugin-runtime-diagnostics.test.ts`, then remove this correction section and retain the existing Unit 4 authorization record. This does not affect completed Units 1–3 or task checkboxes.

## Unit 4 Authoring Gate Interrupted (No Runtime)

- [read] Parent inspections of the initial and corrected package tests found unresolved proof gaps. Awaiting worker exit before checking a previously created startup promise does not prove that the promise remained pending until exit. Checking projected diagnostic text does not observe whether raw worker bytes reached parent/MCP stdout. The current manually constructed worker also bypasses observation of production host factory options.
- [read] The next source correction must observe exit state at the instant startup settles, attach rejection handling immediately, capture parent stdout with bounded restored instrumentation, observe actual host worker-construction options under a parent canary, and re-check the installed worker hash before manifest issuance and final output. Do not claim those properties from the current tests.
- [executed] Native settlement `fcffb1` recorded this source-only attempt as `interrupted` and returned `state: proceed`. No build, pack, test, typecheck, worker, or container command ran; no acceptance JSON was generated. This was a second artifact-contract failure, not a runtime/environment failure or a ledger block.
- Unit 4 remains incomplete: **11 of 13 tasks complete; 4.1 and 4.2 pending**. Preserve the draft tests and all completed Units 1–3. A fresh bounded authoring continuation is required before the proposed isolated build/pack/RED sequence.


## Unit 4 Proof Correction and Executed Baseline RED

This continuation retains every earlier section as historical evidence. It supersedes the earlier pending source-gate descriptions; it does not change completed task checkboxes.

- The corrected package test (SHA-256 `813ca3d269509ac01c55a49ad91ac691981707c60f3d2a01b0595605de67202c`) omits worker injection and observes the production host's public worker. The parent canary precedes raw construction, startup settlement handlers check actual exit state immediately, and bounded/restored instrumentation observes actual parent stdout. The same frozen worker and built-in-only fixture are checked again before manifest issuance and final JSON.
- Parent-owned isolated baseline build completed with exit `0` (ESM `64 ms`, DTS `3993 ms`); offline `corepack pnpm@9.15.9 pack` and tarball extraction also exited `0`. These are parent-provided executed results, not commands run by this source-only writer.
- Baseline tarball: `/work/.unit4-red-20260909.asdzZ9/mcp-llm-bridge-0.6.0.tgz`, SHA-256 `b7efcc34c61486a6d10b7a46d895ed39e135de6c4337a4d27b9297760b78f317`.
- Parent-owned isolated command, cwd `/work`: `node --import tsx --import ./test/setup/inject-require.mjs --test test/e2e/plugin-runtime-package.test.ts test/mcp-builder/plugin-runtime-diagnostics.test.ts`, with explicit installed package root and fresh acceptance output, exited `1`: **6 tests, 4 passed, 2 failed**, duration `1024.183707 ms`. Both failures were the required pre-import assertion for missing `dist/loader.js`.
- RED log: `/tmp/unit4-red-tests-20260909.log`, SHA-256 `e0458fc145f6782aea48ad07e50a1a8b290615613311b2ca52e529d0cf97d641`. The two baseline diagnostic tests **passed**. The shared-budget defect was identified by source inspection; this baseline did **not** reproduce it at runtime. The new deterministic regression below has not been run against either version by this writer.
- Parent reported 27 proof-input hashes matched, no mounts/network, no acceptance JSON, and a retained idle container. No installed compatibility PASS follows from this baseline.

## Unit 4 GREEN Source Implementation (Pending Independent Proof)

- `tsup.config.ts` now includes the existing loader, host, and registry beside the unchanged CLI/worker entries. `splitting: false` keeps bundled internal worker/protocol JavaScript inside the hashed worker entry. The SQL migration-copy hook is unchanged. Actual flat emitted files and installed relative resolution still require independent build/pack proof.
- `PluginRuntimeHost.capture()` now subtracts **both** streams' emitted-byte counters from one 64 KiB worker-lifetime budget. The 8 KiB event limit, UTF-8 projection, per-stream dropped counters, draining, and no-callback behavior at zero budget remain intact.
- The deterministic controlled-worker regression emits eight alternating fixed 8 KiB captures, rejects a ninth emitted chunk beyond the combined budget, and checks dropped-byte accounting on both exhausted streams. Explicit synthetic exit removes host listeners before shutdown rather than waiting for an inert fake worker.
- The real-worker regression awaits bounded UTF-8 write callbacks before RPC completion. It keeps only scalar diagnostic projection data, enforces the combined 64 KiB limit and per-event 8 KiB limit, and checks all 512 KiB written to each stream against its emitted-plus-dropped counters. A stream with zero projected events is valid once the aggregate budget is exhausted.
- `docs/plugin-runtime-cancellation.md` documents call-time configuration, the external five-field compatibility evidence requirement, closed-root digest, actual-tarball acceptance command, and deployment/lifecycle limitations. It explicitly states installed qualification is pending and excludes native/ABI/clean-install or broad platform compatibility claims.
- This source-only writer ran no build, package, compiler, tests, worker, container, install, ledger, or delivery operation. No acceptance JSON was created or edited. Package acceptance source hash remains unchanged. Parent-owned installed GREEN, combined regressions, and TypeScript proof are still required.
- Cumulative task state remains **11 of 13 complete; 2 pending**: `4.1` and `4.2`. All prior completed tasks and progress history are retained; `tasks.md` is unchanged.

### Pending Independent Evidence and Rollback Boundary

Build and pack these exact candidate bytes, run the guarded installed-package qualification with a fresh output, then run the combined regressions and TypeScript check. Do not infer PASS from source readback. To revert this bounded source subtask, restore only its `tsup.config.ts` entry/splitting changes, host aggregate-budget calculation, diagnostic-test additions, new deployment guide, and this appended progress record. Retain the corrected package acceptance test, Units 1–3, prior evidence, and all task checkbox state.


## Unit 4 Flat Entry Correction (Pending Independent Proof)

- Parent-provided isolated GREEN evidence before this correction: build and pack exited `0`; TypeScript exited `0`; the installed/combined suite ran **71 tests, 69 passed, 2 failed**, with missing `dist/loader.js`. Test log SHA-256: `20e5c7cff1517c861a5e21f4c1f34179a98dc51264089d1a083d2fac5fa37e15`. These are parent-provided results, not commands executed by this source-only writer.
- The entry array emitted nested `dist/mcp-builder/*` paths instead of the required flat package entries. `tsup.config.ts` now uses explicit flat names for `index`, `plugin-runtime-worker`, `loader`, `plugin-runtime-host`, and `plugin-runtime-registry`; `splitting: false`, ESM, declaration generation, and migration copying are unchanged.
- Only the source-prequalification regex changed to require the worker mapping in the entry object. Installed flat-path assertions, actual production Worker observations, and the guarded acceptance transaction remain byte-unchanged.
- No runtime, build, pack, compiler, install, container, or acceptance-output operation ran in this correction. Independent isolated GREEN proof is still required; no installed compatibility PASS is claimed.
- Cumulative task state remains **11 of 13 complete; 2 pending**: `4.1` and `4.2`. All earlier progress remains intact and no task checkbox changed.


## Unit 4 Hung Import Fixture Correction (Pending Independent Proof)

- Parent-provided flat-entry GREEN evidence: build, pack, and TypeScript each exited `0`; the installed/combined suite ran **71 tests, 70 passed, 1 failed**. Flat-entry and diagnostic checks passed, but the installed transaction expected `IMPORT_TIMEOUT` and received `WORKER_EXITED`. No acceptance JSON was produced. Test log: `/tmp/unit4-flat-tests-20260909.log`, SHA-256 `cfb685e236ce2dd2eaf1cb4225dc5805b445f482d76ce5546a0afed8e5ced20f`. These are parent-provided results, not commands run by this writer.
- Source diagnosis: the installed fixture awaited an unresolved promise without an active handle. The production worker installs its message listener only after import succeeds (`plugin-runtime-worker.ts:124-127,164-165`); the host reports an exit without a termination code as `WORKER_EXITED` (`plugin-runtime-host.ts:283-293`). Together with the existing hung-import test's referenced interval (`plugin-runtime-worker.test.ts:123-124`), this supports idle worker exit before the deadline as the cause; it is a source inference, not a separately executed reproduction.
- Only the fixture's hung branch now owns a referenced interval while import remains unresolved, with a local cleanup path and worker termination as the final lifecycle boundary. The existing exact `IMPORT_TIMEOUT`, real-exit-at-settlement, admission, environment, stdout, digest, and exclusive final-output assertions are unchanged. No production source or timeout value changed.
- No runtime, build, pack, compiler, install, container, or acceptance-output operation ran in this source correction. Independent isolated GREEN proof remains required; tasks remain **11 of 13 complete; 4.1 and 4.2 pending**, with all prior progress and task checkboxes retained.


## Unit 4 Completion (Accepted Isolated Proof)

All earlier records remain historical evidence. This completion covers tasks `4.1` and `4.2` only; formal SDD verification and archive are still pending.

### Parent-Owned Execution Evidence

- Retained isolated container: `plugin-unit2-final-20260908`, cwd `/work`, Node `22.23.2`, Linux `x64`, TypeScript `5.9.3`. Parent reported `Mounts=[]`, `Networks={}`, 27 proof-input hashes matching before and after, and only `sleep infinity` remaining after execution.
- Build exited `0` (ESM `53 ms`, DTS `3184 ms`); offline pack and extraction exited `0`. Actual archive SHA-256: `91824240eae7ed8cc46a3cddffd9f618c4a277c5c3b9feacf3671dbc4c4653a7`.
- Installed/combined proof: **71 tests passed across 13 suites; 0 failed, skipped, or cancelled**, duration `1411.646067 ms`. Independent `tsc --noEmit` exited `0`. These results were executed by the parent-owned isolated harness, not this documentation-only writer.
- The hung fixture's live handle allows the unchanged exact `IMPORT_TIMEOUT` and real-exit-at-settlement assertions to pass. Flat installed entries, combined diagnostic budget, raw production Worker observations, empty environment/arguments, actual parent stdout isolation, frozen hashes, missing evidence, all five tuple mismatches, and matching admission passed without assertion relaxation.

| Retained log / artifact | SHA-256 |
|---|---|
| Container `/tmp/unit4-import-build-20260909.log` | `6e07ee2385076108d528892b2fc15b53823673245e34be58bb926b8bd907ca07` |
| Parent-reported offline pack/extraction log | `bf893692054ad19728e992afb2add6b8b79afd36667eef4c71816ae52ab3b8ac` |
| Parent-reported installed/combined test log | `862e03af36a3ee7609faedd6fe90475db58989b08d51d77916f39b8c4ba40e35` |
| Empty successful TypeScript log | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Observed acceptance JSON | `44be3dbe4751396e6683bfcc4fb12e4c3ad5fa0a5b14a591b2f4241dca2cf337` |

### Observed Artifact and Scope

- The guarded test emitted `/work/.unit4-import-20260909.wnPe1V/acceptance.json` in the retained container. Parent copied it to `test/e2e/results/plugin-runtime-acceptance.json`; this writer read the artifact and verified its SHA-256 without rewriting it.
- The first copy guard exited `1` because the destination results directory was absent. Parent explicitly created the directory and copied successfully. This was an artifact-transfer issue, not a runtime test failure.
- Recorded tuple: Node major `22`, platform `linux`, architecture `x64`, worker-entry hash `979373c018254c1e3c0dafbc1385e6c0e92a24d90e12ebd788147eec71ebafe9`, complete built-in-only fixture digest `0aa8f08703f22afcc73875bf734bc5d2967d3d1fdc70adb7dd2af05ab4d02df9`.
- The artifact was written only after raw qualification, frozen-byte rechecks, all fail-closed admission cases, and matching installed admission. It is observed evidence for that temporary closed fixture, not a self-issued production compatibility manifest.
- Cached dependencies and retained older build outputs limit the proof: no clean installation, clean-output reproducibility, native dependency closure, ABI certification, other platform/runtime qualification, or general project approval is claimed. An actual deployment plugin root needs its own external qualification.

### Task Completion and Next Step

- `4.1` is complete from the observed artifact and the parent-owned installed qualification/admission evidence. `4.2` is complete from the deployment guide covering configuration, allowlist, manifest, bounds, limitations, acceptance, explicit rollback, and deployment behavior.
- Tasks `4.1` and `4.2` are now checked; cumulative progress is **13 of 13 complete**. Prior completed tasks and every earlier progress line remain intact.
- No source, tests, acceptance JSON, ledger, or runtime operation was changed or executed by this documentation-only writer. This record is not a native attempt settlement, formal SDD verification verdict, review receipt, or delivery authorization.
- Next: run formal SDD verification through the parent-owned workflow, address any reported gaps, and archive only after that verification permits it. Deployment qualification remains environment/root-specific.


## Unit 4 Documentation Gate Correction

- Before final task closure, the artifact gate identified missing tools-only closed JSON protocol documentation and exact design limits in the deployment guide. The earlier completion record remains historical; this is its bounded documentation correction, not a new runtime attempt.
- Added the five closed envelope shapes, tools-only manifest/tool/security fields, rejected non-JSON/transfer surface, and exact limits checked against `design.md:13` and `src/mcp-builder/plugin-runtime-protocol.ts`: 1 MiB envelope, depth 32, 10,000 counted nodes/entries/keys, 256 KiB strings/keys, and 128-byte request IDs. The shared traversal-count wording matches the implementation rather than suggesting 10,000 independent allowances.
- Existing 71/71 isolated proof, artifact hashes, cached-dependency/retained-output caveats, deployment restrictions, and every prior progress line remain unchanged. No source, tests, acceptance JSON, tasks, ledger, or runtime operation was changed or executed.
- The documentation gap is addressed for the parent's one fresh artifact recheck. Task checkboxes remain 13/13; final task-closure validation, formal SDD verification, and archive are not claimed by this correction.
