# Plugin-runtime delivery-slice inventory

This document inventories the already-implemented plugin-runtime work that remains dirty after gateway commit `87ecd7836a47751794f66e814d42f4b52e9aa120` and diagnostics commit `ee9e7d257126c2e7dc6498bb171d952597ba6b56`. It does not implement, normalize, stage, commit, publish, or reopen the archived SDD change. WP00 remains open.

## Decision first

**Inventory status: completed; focused source-level verification passed.** Runtime implementation is present. The historical 39/39 no-emission receipt and later 1/5 worker-fixture failure remain separate historical evidence. A dedicated first-case probe located the fixture-emission/module-context mismatch; the authorized test-only emitter correction then passed a fresh full 5/5 worker gate, the previously unrun real-worker diagnostics case 1/1, and `tsc --noEmit` on offline Node 22. A later isolated runtime-composition seam passed 2/2 plus `tsc --noEmit` in the same approved offline container. These receipts are not a 45-case or 71-case aggregate, and none is package qualification, delivery authorization, review PASS, or WP00 closure.

The runtime behavior covered by this inventory is limited to:

- legacy mode by default; worker mode only by explicit configuration and a five-field compatibility manifest;
- tools-only version-1 worker protocol with bounded JSON, stable error codes, and correlation IDs;
- persistent worker closures, import timeout that waits for observed worker exit, observational invocation timeout, quarantine, and sibling isolation;
- bounded stdout/stderr diagnostics that never forward raw worker output to MCP stdout;
- filename/manifest and tool-collision admission owned by the internal runtime registry;
- registry cleanup before SDK/service cleanup on startup failure and graceful shutdown;
- flat ESM package entries and an installed-package qualification seam.

This is **not** scanner-issued opaque diagnostic identity, supply-chain authorization, an OS sandbox, hard cancellation of native I/O or descendants, clean-install/native-ABI/cross-platform qualification, or production readiness. Do not reopen “missing cancellation”: the archived scope already implements and verifies its bounded cancellation/lifecycle contract.

## Current candidate identity and measured size

The current base is `HEAD=ee9e7d257126c2e7dc6498bb171d952597ba6b56`. The 27-path repository-relative patch at `/tmp/runtime-emitter-fix-2h3e7y5k/artifacts/delivery-candidate.patch`, SHA-256 `f20ec9a70daa3681a3ae2f6729612186081d557fcde68eff71ba9dd945438acc`, is now a **historical prerequisite snapshot**, not the complete current candidate. It applies first; the fresh 3-path runtime-composition delta at `/tmp/runtime-composition-correction-20260910/runtime-composition-3path.patch`, SHA-256 `367aa7fcc445097df44f474b9ff834c801be0be24f71af99b72bd8428bb1d7b3`, is `259 additions / 66 deletions = 325 changed lines`, applies after it, and shares `src/bootstrap/runtime-context.ts`. The delta is not independently applicable to HEAD. The composed source candidate therefore owns 29 paths. Both patch applications were verified in owned scratch trees; the older `63f1e2…` patch and `49e18…` manifest remain historical pre-emitter-correction evidence only.

The historical prerequisite inventory was `3,069 additions / 74 deletions` across 27 paths. The directly measured full union against `HEAD` is **3,325 additions / 137 deletions = 3,462 changed lines** across 29 paths. The 3-path delta remains `259 / 66` because its runtime-context replacement removes three lines that were additions in the prerequisite; the resulting current `runtime-context.ts` diff against `HEAD` is `15 / 63`.

The 400-line review budget is therefore high-risk. A single-PR delivery would need a new explicit `size:exception`; the archived one-PR/size-exception decision is historical archive state, not consent for this current dirty candidate. One honest dependency-aware cut yields four cohesive units, but each remains over 400 lines because tests and evidence stay with the behavior:

| Unit | Cohesive scope | Measured delta | Dependency |
|---|---|---:|---|
| 1 | Runtime configuration + closed protocol: config source/tests and protocol source/tests | **629 additions / 0 deletions** | None; foundation for all later units. |
| 2 | Worker/host lifecycle, bounded diagnostics, adapter proxy path, worker/diagnostic tests, adapter regression, worker-emission fixture | **845 additions / 23 deletions** | Unit 1 protocol/config. |
| 3 | Registry/loader/MCP/bootstrap/shutdown wiring, package entry configuration, registry/lifecycle/bootstrap tests, shared harness fixture, and isolated runtime composition | **1,344 additions / 114 deletions** | Units 1–2; Unit 4 consumes the delivered harness. |
| 4 | Installed-package prequalification/qualification test, retained acceptance JSON, deployment guide | **507 additions / 0 deletions** | Unit 3 plus an actual built/packed package; no duplicate fixture ownership. |

The U1/U2/U4 values remain historical ledger measurements. The historical prerequisite recorded U3 as `1,088 additions / 51 deletions`; the directly measured current U3 total is `1,344 additions / 114 deletions`. Every candidate path has exactly one unit owner. All four units remain above the 400-line review budget; this is a sizing fact, not a reason to split behavior from its tests or fixtures.

### One-pass path/hunk ownership ledger

The ledger is the delivery boundary. A tracked shared file is assigned only its runtime hunks described below, not unrelated dirty hunks; an untracked file is assigned as a whole. The `+/-` values are measured against `HEAD=ee9e7d2` for tracked paths and whole-file additions for untracked paths.

| Unit | Exact path or hunk | `+ / -` | Prerequisite availability |
|---|---|---:|---|
| U1 | `src/core/mcp-runtime-config.ts` — worker mode/defaults, environment allowlist, compatibility manifest | 137 / 0 | None |
| U1 | `src/mcp-builder/plugin-runtime-protocol.ts` — complete v1 bounded protocol | 278 / 0 | None |
| U1 | `test/mcp-builder/plugin-runtime-config.test.ts` | 112 / 0 | U1 config |
| U1 | `test/mcp-builder/plugin-runtime-protocol.test.ts` | 102 / 0 | U1 protocol |
| U2 | `src/mcp-builder/adapter.ts` — worker proxy registration path | 15 / 0 | U1 config/protocol |
| U2 | `src/mcp-builder/plugin-runtime-host.ts` — host lifecycle, timeouts, quarantine, diagnostics | 327 / 0 | U1 protocol |
| U2 | `src/mcp-builder/plugin-runtime-worker.ts` — worker import/dispatch/protocol projection | 168 / 0 | U1 protocol |
| U2 | `test/mcp-builder/adapter.test.ts` — runtime proxy/error regression hunk | 4 / 23 | U2 adapter |
| U2 | `test/mcp-builder/plugin-runtime-worker.test.ts` | 165 / 0 | U2 host/worker |
| U2 | `test/mcp-builder/plugin-runtime-diagnostics.test.ts` | 138 / 0 | U2 host |
| U2 | `test/mcp-builder/fixtures/plugin-runtime/emit-runtime-worker.ts` | 28 / 0 | U2 worker test fixture; virtual `.mts` metadata emits ESM `.js` bytes |
| U3 | `src/mcp-builder/plugin-runtime-registry.ts` — admission, collision ownership, invoke/close | 130 / 0 | U1 protocol; U2 host contract |
| U3 | `src/mcp-builder/loader.ts` — worker/root hashing, compatibility admission, registry handoff hunk | 162 / 5 | U2 host + U3 registry |
| U3 | `src/server/mcp-server.ts` — runtime loader/registry/cleanup hunks only | 85 / 44 | U2 host + U3 registry |
| U3 | `src/bootstrap/runtime-context.ts` — shared registry construction and zero-argument composition wrapper | 15 / 63 | U3 registry |
| U3 | `src/bootstrap/runtime-composition.ts` — type-only dependency composition with no runtime value-import closure | 94 / 0 | U3 registry/foundation wiring |
| U3 | `src/bootstrap/server-startup.ts` — registry pass/failed-start cleanup hunks | 8 / 1 | U3 registry |
| U3 | `src/bootstrap/shutdown.ts` — registry cleanup ordering hunk | 7 / 0 | U3 registry |
| U3 | `src/index.ts` — shutdown registry handoff hunk | 1 / 0 | U3 bootstrap |
| U3 | `tsup.config.ts` — flat runtime entry/no-splitting hunk | 9 / 1 | U2 worker/host + U3 registry |
| U3 | `test/mcp-builder/plugin-runtime-registry.test.ts` | 356 / 0 | U3 registry |
| U3 | `test/bootstrap/plugin-runtime-lifecycle.test.ts` | 280 / 0 | U3 bootstrap/server |
| U3 | `test/bootstrap/runtime-context.test.ts` — injected registry cleanup hunk | 1 / 0 | U3 context |
| U3 | `test/bootstrap/runtime-composition.test.ts` — isolated order/reference and failure short-circuit tests; existing integration test unchanged | 150 / 0 | U3 composition seam |
| U3 | `test/bootstrap/server-startup.test.ts` — registry dependency hunk | 2 / 0 | U3 startup |
| U3 | `test/mcp-builder/fixtures/plugin-runtime/unit3-harness.ts` | 44 / 0 | U3 registry/lifecycle tests; consumed by U4 |
| U4 | `test/e2e/plugin-runtime-package.test.ts` | 364 / 0 | U3 package entries + U3 harness + actual package bytes |
| U4 | `test/e2e/results/plugin-runtime-acceptance.json` — retained result artifact | 1 / 0 | U4 qualification run |
| U4 | `docs/plugin-runtime-cancellation.md` — deployment/qualification guide | 142 / 0 | U4 package evidence |

The fixture ownership is deliberate: `emit-runtime-worker.ts` is used only by U2 worker/diagnostic tests; `unit3-harness.ts` is delivered in U3 because registry/lifecycle tests import it, then U4 consumes that prerequisite. Neither fixture is counted twice or delayed into a dependent slice. Unit 4 is therefore the only unit whose functional evidence still requires an actual built/packed installed package; this inventory does not build or repack one.

These are one-pass work-unit boundaries, not a request to create branches or PRs now. No serial micro-fragments, reformatting, deletion, or code-golfing is recommended. Delivery strategy remains a maintainer decision: a chained sequence is reviewable but needs a chain strategy; one PR requires a new size exception. No decision is being inferred here.

## Historical and current focused verification

The approved offline Node `22.23.2` container ran isolated snapshots with cached `/work/node_modules`, synthetic HOME/XDG/TMP paths, no mounts, and no attached network. Historical no-emission evidence measured **3,068 additions / 74 deletions**. The **historical** normalized 27-path prerequisite snapshot measured **3,069 additions / 74 deletions** and remains apply-verified; the directly measured current 29-path union is **3,325 additions / 137 deletions = 3,462 changed lines**. The historical snapshot preserved its protected tree byte-identically; the current composition correction preserved all non-owned bytes/modes, while HEAD and index remained unchanged.

| Authorized no-emission gate | Actual command in `/work/.plugin-runtime-slice-verify-z94sS0/snapshot` | Result | Retained log SHA-256 |
|---|---|---:|---|
| Configuration | `node --import tsx --test test/mcp-builder/plugin-runtime-config.test.ts` | 4/4, exit 0 | `aff818eafec2dc3a33c5491d12e537f148e93d4f48ceda9eeff3fe7ce54056ae` |
| Protocol | `node --import tsx --test test/mcp-builder/plugin-runtime-protocol.test.ts` | 6/6, exit 0 | `205507598fa8428548b1ae20c0ed12e19c8f540320a7eb4949c3e9ba6c3381e4` |
| Adapter | `node --import tsx --test test/mcp-builder/adapter.test.ts` | 10/10, exit 0 | `8dcfc4ff49aa8100d633608de42def6c88e3d964240ace2e1cb6beccae6a622c` |
| Registry | `node --import tsx --test test/mcp-builder/plugin-runtime-registry.test.ts` | 6/6, exit 0 | `ea2fa275787ffa0be856031084869d0568d2102378b5e15e6ce251bb08de3ffd` |
| Lifecycle | `node --import tsx --test test/bootstrap/plugin-runtime-lifecycle.test.ts` | 6/6, exit 0 | `ab566d38d8a2e86c4066320783e3adb6edc50fab3238161ccca5fe93793883c9` |
| Startup wiring | `node --import tsx --test test/bootstrap/server-startup.test.ts` | 5/5, exit 0 | `fbf3bd05b5c8044a72499ff26a320a327f18bcdffac8be916059a41c80483dd5` |
| Diagnostics, selected no-emission cases | `node --import tsx --test --test-name-pattern='shares one 64 KiB lifetime budget across controlled stdout and stderr captures|keeps startup pending through an intermediate error and settles import timeout exactly once on observed exit' test/mcp-builder/plugin-runtime-diagnostics.test.ts` | 2/2, exit 0 | `bbd4e53cb86c6437566d08d49bb917ee5f2277e6e36fd8ba4c8200a585caaba2` |
| Typecheck | `/work/node_modules/.bin/tsc --noEmit` | exit 0 | empty log, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The exact selected count is **39/39**. It is not the historical 71-case archive total, a full runtime pass, or package qualification.

### Later authorized fixture-emission receipt: failed

The user explicitly granted the narrow exception to let `emitPluginRuntimeWorker()` transpile only worker/protocol JavaScript into new isolated temporary fixtures. This was not a project build, package, install, provider, runtime-context, or delivery authorization. A fresh `HEAD=ee9e7d2` plus the same exact 27-overlay patch then invoked the following gate **once** in `/work/.plugin-runtime-worker-verify-xjdwuN/candidate`:

| Gate | TAP outcome | Evidence |
|---|---:|---|
| `node --import tsx --test test/mcp-builder/plugin-runtime-worker.test.ts` | 5 named cases: **1 pass / 4 fail** | `/tmp/plugin-runtime-worker-verify-xjdwuN/logs/worker-five.log`, SHA-256 `6779cb9cb524cfed86dd7c377d42f0993f936b358ec500782d6d407ba61296a6` |

The four failed named cases report `PluginRuntimeHostError` code `WORKER_EXITED`; the timed-out-real-import/observed-exit case passed. This paragraph describes the historical failing receipt only. Its then-unresolved immediate mechanism was later identified by the separate startup probe and corrected in the current test-only helper.

A secondary outer-shell fault occurred only **after** `docker exec` returned: zsh rejected assignment to its reserved `status` parameter. It left the numeric process exit unrecorded, but it did not cause the already-recorded `WORKER_EXITED` failures; the retained TAP has `# fail 4` and `ERR_TEST_FAILURE`. The failed gate was not retried. The sixth, separately authorized real-worker diagnostics case (`bounds real worker events and the shared lifetime while draining both streams`) was not run after this primary failure.

### Follow-up startup probe: observed mechanism confirmed (historical, before the fix)

The preceding statement that the immediate mechanism was unresolved remains the historical account of the five-case receipt. A later, separate one-subtest probe observed the first worker case only; it did not rerun the five-case gate or diagnose the other three `WORKER_EXITED` cases. The probe exited `1` with one worker `error`, zero worker stderr events, and one worker exit `1`. Its observer captured `ReferenceError: exports is not defined in ES module scope`.

The captured fixture bytes, not a missing module marker, explain that startup failure: both emitted `.js` worker/protocol files had no ESM syntax and contained CommonJS output, while their nearest `/work/package.json` declares `type: module`. Node therefore evaluated CommonJS bytes as ESM and failed before worker readiness. The earlier missing-module-marker hypothesis was the wrong direction: the relevant module scope exists, but the generated bytes do not match it. This is a confirmed **test-fixture emission/module-context mismatch** for the captured first case—not a production defect, a general Node defect, or installed-package qualification.

The probe used an isolated scratch test observer only. Canonical host, worker, protocol, emitter, and test bytes remained unchanged; HEAD/index and the protected manifest remained unchanged; fixture directories were cleaned and no Node process remained. Evidence is retained at `/tmp/worker-startup-probe-4w1kwgc3/artifacts/proof.json` (SHA-256 `357fab8a50dc4820d580d458f52941a7bef691b2ac4ec069245394b8a4d9c9dc`), `worker-observation.json` (SHA-256 `babe25d1280d55084be64937e207cc2901fb1ca584f74b53c8f1741c99383ef7`), `test.stdout` (SHA-256 `f90c72b46d2324d1d49a8045d167df78d9f64e5f3f451c932a5e5f5cf052cde6`), and scratch-only instrumentation diff (SHA-256 `cd764616d2be226dbed8598d6bdbceee627fb3da3efb68fe69a183b5d9f72410`).

This new receipt is distinct from the earlier **39/39 + `tsc --noEmit` exit 0** no-emission receipt. Do not aggregate them as 45 checks, and do not substitute either for the historical 71-case archive result. `/tmp/plugin-runtime-worker-verify-xjdwuN/proof.json` (SHA-256 `a0a9a2bf6fb6cf5305ecc383c53f42b0dfde505f09e6b0ab6d2e545069b82462`) records the exact patch SHA `63f1e2ea11260ed6a648f4a6829f350d0a0b48168c5e5505bf164764d96fbbf1`, 27-overlay verification, empty isolated diff check, and unchanged protected repository pre/post contents/modes manifest SHA `46efac8dbeb900ce63dfcdc198294982271cbb474bf16c1447301669e7bd4dc0`, plus unchanged HEAD and empty index.

### Authorized test-only correction and focused green receipt

`emit-runtime-worker.ts` now passes a virtual `.mts` filename to `ts.transpileModule` under `NodeNext` while retaining `.js` output paths. This changes only fixture emission metadata; it does not change runtime source, worker options, package bytes, configuration, or APIs. The helper is 28 lines / 1,215 bytes, SHA-256 `c2ebb8bd91e1128f0539e5467206f4db8d6109225882d1769dd8484e88a2dfc3`.

| Gate | Result | Retained log SHA-256 |
|---|---:|---|
| Emit-only metadata preflight | ESM syntax in worker and protocol; no CommonJS `exports`; exit 0 | `2d471bfaebfd79b1c2f43d953a0f8f0b786cc72d49da5d71cac808a2a2191cef` |
| `node --import tsx --test test/mcp-builder/plugin-runtime-worker.test.ts` | 5/5, exit 0 | `21a53a8091f5dfca39e6308967aac4c160da8866b5acddb27cf6583b671b0b4d` |
| real-worker diagnostics name filter | 1/1, exit 0 | `7dac1e106b65c815eee10f4efb27b0a3e9ae76d8b86dd924d8a956fac2f77bbe` |
| `/work/node_modules/.bin/tsc --noEmit` | exit 0 | empty log |

The fresh proof is `/tmp/runtime-emitter-fix-2h3e7y5k/artifacts/proof.json`, SHA-256 `e428d30d76a06532c88b9b42fdbbad07ba9a1783f8c446323345040636aa7469`. It records the protected-tree exception (only the helper changed), no remaining fixture directories or Node processes, and the repository-relative candidate application proof.

### Isolated runtime-composition extraction: completed

The follow-on extraction moves the actual orchestration into `composeRuntimeContext()` while preserving the exported zero-argument `createRuntimeContext()` production wrapper and its ordering, awaited leaves, merge precedence, and plugin-registry ownership. `src/bootstrap/runtime-composition.ts` has no runtime value imports: its dependencies are type-only inputs. The wrapper supplies the real leaves; the isolated tests call the actual composition helper with deliberately limited fakes rather than a copied orchestration model. `test/bootstrap/runtime-context.test.ts` was not changed.

The initial typecheck receipt is retained as historical failure evidence. It reported `TS2724` because `createSupportServices` was type-imported from the wrong `./core-services.js` module, along with the unused `RuntimeFoundation` import and a consequential test `TS7006` implicit-`any` symptom. The single correction imports that type from `./support-services.js` and removes the unused type; it does not add `any`, alter production behavior, or change the test helper.

| Fresh focused gate | Result | Retained host log SHA-256 |
|---|---:|---|
| `node --import tsx --test test/bootstrap/runtime-composition.test.ts` | 2/2, exit 0 | `/tmp/runtime-composition-correction-20260910/logs/corrected-focused.log`; `24497df4e91c1d017fb35243e02a820db0b80cb55aa4a6904f5567db17a6ce84` |
| `/work/node_modules/.bin/tsc --noEmit` | exit 0 | `/tmp/runtime-composition-correction-20260910/logs/corrected-tsc.log`; empty-log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The focused test and typecheck ran once in a fresh `HEAD`-plus-27-prerequisite scratch candidate in the approved offline Node 22 container. The 3-path delta proof is `/tmp/runtime-composition-correction-20260910/proof.json`, SHA-256 `3a356139faa584801c20788bc82f9ed77199da241d851900a4838720aaab9a23`; its patch is the `367aa7…` artifact named above. It records application to another owned prerequisite scratch base, matching candidate bytes, and identical non-owned bytes/modes before and after.

**Scope limits:** this receipt exercises real `composeRuntimeContext()` with fakes, not the zero-argument wrapper with real dependencies. Spread-collision precedence was source-read verified, not a direct assertion. No real runtime initialization, provider/model/DB/network work, package qualification, current source-to-artifact provenance, RDD receipt, or delivery authorization follows.

### Excluded coverage and stop boundary

- The historical five-case failure remains historical evidence; the fresh corrected full five-case gate passed 5/5 and is not aggregated with the earlier 39/39 receipt.
- The formerly unrun real-worker diagnostics case now passed once as the focused 1/1 gate; it is not a full diagnostics suite.
- `test/e2e/plugin-runtime-package.test.ts` is excluded: its installed-package branch requires actual package bytes and writes an acceptance output. No current package qualification follows from the source-level preconditions.
- `test/bootstrap/runtime-context.test.ts` is excluded because it constructs the real runtime/provider/model graph, outside this no-provider verification.
- Retained package availability was read only: `/work/.unit4-import-20260909.wnPe1V/node_modules/mcp-llm-bridge` exists, reports version `0.6.0`, and its worker entry SHA-256 matches `979373c018254c1e3c0dafbc1385e6c0e92a24d90e12ebd788147eec71ebafe9`. It is not a current package artifact or fresh qualification.

### Retained historical package identity: completed read-only inventory

Historical artifact identity is now verified, not re-qualified. The approved offline container `plugin-unit2-final-20260908` was observed running as `42cac9c2f14c1778c037df8fa24832102ab8fb8115a1e5c466e52da4d9fe6bbb` from image `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d`, with mounts `[]` and networks `{}`. Inspection only read package/archive metadata and SHA-256 values; it did not extract, import, execute, build, pack, install, or mutate anything.

| Retained evidence | Verified read-only fact | Boundary |
|---|---|---|
| Imported package root | `/work/.unit4-import-20260909.wnPe1V/node_modules/mcp-llm-bridge`; `package.json` reports version `0.6.0` and package publishing intent `files: ["dist", "README.md"]`. | The manifest is publication intent, not proof that every archive member or installed file set is identical. |
| Installed Worker | `dist/mcp-builder/plugin-runtime-worker.js` exists with SHA-256 `979373c018254c1e3c0dafbc1385e6c0e92a24d90e12ebd788147eec71ebafe9`. | This matches the historical acceptance observation; one entry hash does not establish complete package equality or freshness. |
| Exact retained tarballs | `/work/.unit4-flat-20260909.26o1Cr/mcp-llm-bridge-0.6.0.tgz` and `/work/.unit4-import-20260909.wnPe1V/mcp-llm-bridge-0.6.0.tgz` both SHA-256 to `91824240eae7ed8cc46a3cddffd9f618c4a277c5c3b9feacf3671dbc4c4653a7`. | These are historical artifacts, not artifacts built from the current candidate. |
| Archive metadata | Each expected tarball lists 54 members, including `package/dist/mcp-builder/plugin-runtime-worker.js` at 14,104 bytes. | Metadata was listed without extraction; this does not create a source-to-artifact provenance link. |

**Readiness inventory: completed.** Historical package/artifact identity is verified. **Current-candidate artifact linkage is not established:** no package was built from the composed 29-path candidate, and the virtual `.mts` emitter correction is test-only rather than a shipped-package path. Commit ancestry (`87ecd78` and `ee9e7d2` are ancestors of current HEAD) also does not establish tarball provenance.

### Setup-only failures before gates

Two initial scratch setup commands failed before any product or test command executed: (1) the first one-line Python manifest invocation ended with `SyntaxError: unexpected character after line continuation character` because literal `\\n` text was passed in the command string; (2) the next zsh setup loop used the special variable name `path`, overwrote `PATH`, and then emitted `command not found` for `stat`, `sha256sum`, and `awk`. A new clean scratch root (`/tmp/plugin-runtime-slice-verify-z94sS0`) was used for the recorded gates. These were setup failures, not failed or retried test gates.

## Exact path inventory

### Tracked modified paths

All current tracked paths below are regular non-executable files (`Git mode 100644`, current POSIX mode `0664`). SHA-256 values are current worktree bytes; `+/-` is the measured `git diff --numstat` against `HEAD`.

| Path | Current SHA-256 | Bytes | + / - | Role and unit |
|---|---|---:|---:|---|
| `src/core/mcp-runtime-config.ts` | `96304f3ead01a20b4d112be5fe9b20cd6b95fa07754e844af758f8dcd899a243` | 5,805 | 137 / 0 | Mode/defaults, allowlisted environment, exact compatibility manifest; U1. |
| `src/mcp-builder/adapter.ts` | `a06874429d22b08de35276dc7ec3f384883c1cafa5f56433758b39da3f06d6b7` | 6,882 | 15 / 0 | Worker-proxy registration bypasses main-thread timeout/quarantine wrappers; U2. |
| `src/mcp-builder/loader.ts` | `53f373ca600b04064cb107d222b68649d305cfd3af57e35815e6f3eb94880671` | 11,659 | 162 / 5 | Worker entry/root hashing, compatibility admission, host creation, registry handoff; U3. |
| `src/server/mcp-server.ts` | `f22b960e700e3e1c93a1b855265601fb174e07d53232b75676ee4a14450e95ae` | 14,137 | 85 / 44 | Selects legacy/worker loader, admits plugins, owns close/error cleanup; U3. |
| `src/bootstrap/runtime-context.ts` | `a2abf954dc4c2faa5c3f671e2d5344ecc96f9af72ffa74e6d6d0d2a8f916d9d9` | 825 | 15 / 63 | Zero-argument wrapper supplies real leaves to the composition helper; U3. |
| `src/bootstrap/server-startup.ts` | `a2459ed2352577050f3e51234ac879f69a2d689f2fcc73bf73630bbad9a007a9` | 3,024 | 8 / 1 | Passes registry into MCP and closes it on startup failure; U3. |
| `src/bootstrap/shutdown.ts` | `ff1e3c1b49cfe3a97f80e3cedb4ba313b4ec918f3f3c4a5ccf3e9adb12573efb` | 3,667 | 7 / 0 | Orders registry cleanup during graceful shutdown; U3. |
| `src/index.ts` | `3f1d230ca425f657d8b8675d08b82fab0abe4b84f770253d962384962f950a1e` | 2,834 | 1 / 0 | Supplies registry to shutdown wiring; U3. |
| `tsup.config.ts` | `893197450f251924215c7cd389a28f124d3b96afffe421c65762b7602c6693dd` | 1,232 | 9 / 1 | Flat ESM entries and no splitting for worker hash boundary; U3. |
| `test/mcp-builder/adapter.test.ts` | `31aec6167201d68fa6fda584ba454e688251ed222bae3353bbdff3f3c68d5899` | 12,942 | 4 / 23 | Updates safe error expectations after raw identity/message removal; U2 adapter regression. |
| `test/bootstrap/runtime-context.test.ts` | `aa62e4d7542d52bb29d7e85ff13b2a6f9e858b71d8e2000dcea4e2698172f666` | 3,413 | 1 / 0 | Closes injected runtime registry in context cleanup; U3. |
| `test/bootstrap/server-startup.test.ts` | `77465768ba6dcb8f47cf1d9e0d6b3aeb20d17ab3282399aa550a36aafb1a6bd1` | 4,786 | 2 / 0 | Preserves registry dependency wiring; U3. |

### New runtime source paths

All are regular non-executable files (current POSIX mode `0664`; Git would record `100644`):

| Path | Current SHA-256 | Bytes / lines | Role and unit |
|---|---|---:|---|
| `src/mcp-builder/plugin-runtime-protocol.ts` | `77cda424625ddb82c70151d09260e1e00722126d67c889690ea0fd0f8a539e32` | 11,024 / 278 | Closed envelopes, manifest/security validation, JSON limits, stable errors, live IDs; U1. |
| `src/mcp-builder/plugin-runtime-host.ts` | `826664a0c84908695c88bc35340fd3889549570225d0a712e69e624af1b75144` | 10,945 / 327 | Worker state machine, exit acknowledgement, invocation timeout, quarantine, diagnostics counters; U2. |
| `src/mcp-builder/plugin-runtime-worker.ts` | `a56bf36cbb2608626d80dd154a1615f6e2e6e830009aeab27dd96700ccf90ee0` | 6,490 / 168 | Worker-side import, tools-only projection, dispatcher, protocol failures; U2. |
| `src/mcp-builder/plugin-runtime-registry.ts` | `c2c5b312026b4d179d45d70fafbb78ea4f6cf8e063e7f6a06f0dcc0466c5dc3a` | 4,929 / 130 | Single-owner admission, filename identity/collisions, invoke and idempotent close; U3. |
| `src/bootstrap/runtime-composition.ts` | `f9b20de7280beb61fefc81c99f8a9a6113535e8ad6f86817fde97907e60fc5db` | 2,761 / 94 | Type-only dependency composition; no runtime value-import closure; U3. |

### New tests, fixtures, documentation, and retained evidence

All new TypeScript/Markdown files are mode `0664`; the retained JSON evidence file is mode `0644`. Each untracked line is an addition to any future candidate diff.

| Path | Current SHA-256 | Bytes / lines | Role and unit |
|---|---|---:|---|
| `test/mcp-builder/plugin-runtime-config.test.ts` | `38754240cc7a90299893f31d4ff707de56e0b952c458dca76194bb661050994d` | 3,989 / 112 | Configuration/default/allowlist/manifest cases; U1. |
| `test/mcp-builder/plugin-runtime-protocol.test.ts` | `1c9b2634197c2bc9d54c31c6839e6690ca578f020dc96e215cb803e42eb2f667` | 5,412 / 102 | Closed envelopes, bounds, hostile values, ID uniqueness; U1. |
| `test/mcp-builder/plugin-runtime-worker.test.ts` | `2ddd7fbfa39e80a7b5b5b740f617c810e28882bedfd8d6c23c7992676f1b6548` | 7,160 / 165 | ESM worker, closure persistence, timeout, late result, sibling isolation; U2. |
| `test/mcp-builder/plugin-runtime-diagnostics.test.ts` | `4c9178c2186ae54b536c3cdef300ed9a2fe77274a944be14d80de7a9ed84a864` | 6,619 / 138 | 8 KiB/event and 64 KiB/lifetime diagnostics; exit/timeout ordering; U2. |
| `test/mcp-builder/plugin-runtime-registry.test.ts` | `d01b16ff9fd9062dcfbf3f7d8385aa98349140179c1191c20a615f3a8313384d` | 15,649 / 356 | Gate, handoff, collision, cleanup, timeout, sibling admission; U3. |
| `test/bootstrap/plugin-runtime-lifecycle.test.ts` | `dc8b6ab3f77626d902ba458c0036042def35704b77e50d6dac74ba5704ed96cc` | 11,770 / 280 | MCP startup failure and shutdown ordering/idempotency; U3. |
| `test/bootstrap/runtime-composition.test.ts` | `66445f91f9af995a5c249bf6e75f66ff21db984caa814ae134974ace1d7b78ef` | 4,750 / 150 | Actual composition success/order/reference and failure short-circuit tests with fakes; U3. |
| `test/e2e/plugin-runtime-package.test.ts` | `d0144d2c5d5fea12612aac5c092dd8ee922998a3e843159807edbea6e658ad92` | 18,203 / 364 | Package-entry/prequalification and installed-package acceptance; U4. |
| `test/mcp-builder/fixtures/plugin-runtime/emit-runtime-worker.ts` | `c2ebb8bd91e1128f0539e5467206f4db8d6109225882d1769dd8484e88a2dfc3` | 1,215 / 28 | Emits ESM worker/protocol fixture bytes through virtual `.mts` NodeNext metadata for U2. |
| `test/mcp-builder/fixtures/plugin-runtime/unit3-harness.ts` | `ddfc0edf243578a86fcaad3ffefd65e2dfcb4c979bfc791030874965a4359218` | 1,391 / 44 | Environment/deferred helpers owned by U3; consumed by U4. |
| `test/e2e/results/plugin-runtime-acceptance.json` | `44be3dbe4751396e6683bfcc4fb12e4c3ad5fa0a5b14a591b2f4241dca2cf337` | 685 / 1 | Retained `plugin-runtime-acceptance/v1` evidence artifact; U4 packaging/evidence, not source. |
| `docs/plugin-runtime-cancellation.md` | `52aa3dda2b23ab06482d299833d25bcddfeb9341e023b3f2d6f7d1c3c4e993d5` | 14,034 / 142 | Deployment/configuration/protocol/limits/qualification/rollback guide; U4. |

### Read-only identity check

The 29 composed-candidate path rows above were recomputed from the worktree: every listed SHA-256 is exactly 64 lowercase hexadecimal characters and matches the file bytes. This includes the registry source, whose verified current hash is `c2c5b312026b4d179d45d70fafbb78ea4f6cf8e063e7f6a06f0dcc0466c5dc3a`; the previously circulated truncated/variant value is not used. Historical archive hashes are kept separate and were not substituted for current path identities.

## Dependency ordering and delivery boundaries

The source dependency order is concrete, not inferred from archive task labels:

1. `mcp-runtime-config.ts` and `plugin-runtime-protocol.ts` define the mode gate, compatibility tuple, bounded wire, and stable errors.
2. `plugin-runtime-worker.ts` and `plugin-runtime-host.ts` implement the worker side and host lifecycle over that protocol; `adapter.ts` supplies the worker-proxy path.
3. `plugin-runtime-registry.ts` owns admission and lifetime; `loader.ts` hashes the installed worker/root, validates compatibility, creates hosts, and transfers ownership to the registry.
4. `mcp-server.ts`, runtime context, startup, shutdown, `index.ts`, and `tsup.config.ts` wire the registry into production startup, MCP loading, cleanup, and package entries.
5. Unit 1–3 tests exercise those boundaries; the shared `unit3-harness.ts` is owned by Unit 3 because registry/lifecycle tests import it. Package qualification (Unit 4) consumes that delivered harness and requires an actual built/packed installed package. It cannot be honestly verified from source-only tests.

The registry's filename identity and collision checks are internal routing/admission. They do not issue scanner diagnostic IDs, prove supply-chain authorization, or replace the unresolved scanner binding contract.

## Archived evidence comparison

The archived OpenSpec change `plugin-runtime-cancellation` is closed and authoritative for its historical scope:

- archived `tasks.md`: SHA-256 `1d5b3dcb31ca59b22da959042f833e78e9a8013e1a78b7c835cac5d2cf02b138`;
- archived `apply-progress.md`: SHA-256 `03dfe8b80f172ea878944cd186ea8f804020c059f5b67902f6a89a847615bffd`;
- archived `verify-report.md`: SHA-256 `b1603e0a7946c30238334f3cb9d0d18d2ed1b7b3e7598fc548afe1a14d27d60d`;
- archived source spec: SHA-256 `3dea0c2c72829fcd2e64a509c2c89e33f7928a9af6b4a45ecab05bb45625c066`;
- deployment guide: SHA-256 `52aa3dda2b23ab06482d299833d25bcddfeb9341e023b3f2d6f7d1c3c4e993d5`;
- archived result: 13/13 tasks, 10/10 requirements, 24/24 scenarios, 71/71 named tests across 13 suites, and `tsc --noEmit` exit 0 in the retained Linux x64 / Node 22.23.2 built-in-only fixture scope;
- retained tarball SHA-256 `91824240eae7ed8cc46a3cddffd9f618c4a277c5c3b9feacf3671dbc4c4653a7`, worker-entry SHA-256 `979373c018254c1e3c0dafbc1385e6c0e92a24d90e12ebd788147eec71ebafe9`, and canonical acceptance JSON SHA-256 `44be3dbe4751396e6683bfcc4fb12e4c3ad5fa0a5b14a591b2f4241dca2cf337`.

The archive's qualifying package path is container-scoped (`/work/.unit4-import-20260909.wnPe1V/node_modules/mcp-llm-bridge`). It was subsequently inspected read-only together with the two exact retained tarball paths recorded above; no package was operated, extracted, or materialized from the current candidate. Archive evidence is therefore **read/historical**, not fresh proof of this dirty candidate.

The archive explicitly excludes clean install, clean-output reproducibility, native dependency/ABI closure, other platforms/runtime majors, arbitrary production roots, hard real-time termination, OS sandboxing, descendant/native-I/O cancellation, rollback of effects, and general production readiness. Do not widen those claims.

## Explicit delivery boundary: excluded OpenSpec and audit paths

The runtime totals and the four-unit ledger exclude the separate containment-planning and audit-control artifacts below. They are not runtime implementation hunks, and they must not be folded into a runtime commit merely because they are dirty or untracked:

- `openspec/changes/containment-and-evidence-harness/proposal.md`;
- `openspec/changes/containment-and-evidence-harness/design.md`;
- `openspec/changes/containment-and-evidence-harness/design/baseline-ledger.md`;
- `openspec/changes/containment-and-evidence-harness/design/contracts.md`;
- `openspec/changes/containment-and-evidence-harness/design/execution-manifest.md`;
- `openspec/changes/containment-and-evidence-harness/design/scenarios-dag.md`;
- `openspec/changes/containment-and-evidence-harness/implementation-handoff.md`;
- `openspec/changes/containment-and-evidence-harness/specs/default-deny-containment/spec.md`;
- `openspec/changes/containment-and-evidence-harness/tasks.md`;
- `openspec/specs/plugin-runtime-cancellation/spec.md` (the canonical spec mirror); and
- `docs/audit/2026-09-01/delivery-slice-gateway-cwd.md`, `docs/audit/2026-09-01/delivery-slice-plugin-diagnostics.md`, `docs/audit/2026-09-01/plugin-runtime-cancellation-options.md`, `docs/audit/2026-09-01/roadmap-current.md`, and `docs/audit/2026-09-01/wp00-progress-current.md` (audit/status control-plane documents).

The archived OpenSpec directory `openspec/changes/archive/2026-09-09-plugin-runtime-cancellation/`—including its proposal, research, exploration, design, archived spec, tasks, apply-progress, verify-report, archive-report, and state files—is historical evidence and remains separate from this candidate. The canonical spec and archived OpenSpec are therefore **reference/evidence inputs, not delivery paths**; they are not edited, counted, or reopened here. The owned runtime inventory and status documents are likewise documentation packaging, not runtime candidate lines.

## Delivery story, rollback, and evidence packaging

### Proposed work-unit messages

If a maintainer later chooses a chained sequence, these messages preserve the dependency story:

1. `feat(plugins): add fail-closed worker protocol and compatibility config`
2. `feat(plugins): isolate worker lifecycle and bounded diagnostics`
3. `feat(plugins): wire admitted workers into registry and server lifecycle`
4. `test(plugins): qualify the installed worker package boundary`

These are proposals only. No branch, PR, commit, stage, or chain strategy was created here.

### Rollback boundaries

- Unit 1 rollback removes the worker-mode config/protocol surface and its tests, returning dynamic plugins to the prior legacy-only configuration.
- Unit 2 rollback removes worker host/worker/proxy, adapter regression, worker/diagnostic tests, and the worker-emission fixture; Unit 1 remains a coherent unused foundation only if the maintainer accepts that intermediate state.
- Unit 3 rollback removes registry/loader/server/bootstrap/package-entry wiring, lifecycle/bootstrap/registry tests, and the shared harness; Unit 4 then cannot qualify until that prerequisite is restored.
- Unit 4 rollback removes package qualification tests, generated acceptance JSON, and deployment guide; it does not claim or delete a published artifact.

Rollback changes future loading behavior only; it cannot undo plugin side effects, native I/O, descendant processes, files, network requests, or database writes already initiated.

### Evidence packaging boundary

The retained `test/e2e/results/plugin-runtime-acceptance.json` is an observed fixture artifact, not a production compatibility manifest. It must remain paired with the exact qualified worker/tarball/root evidence and must never be copied into deployment configuration. The `docs/plugin-runtime-cancellation.md` checklist correctly requires actual package bytes, exact tuple, root digest, and deployment-root qualification.

## Exact next verification plan (stopped; do not resume automatically)

1. **Fixture-emission correction is complete:** the helper emits ESM `.js` bytes and its authorized focused source-level receipt is green. Do not reopen it with more runtime gates.
2. **Runtime-composition isolation is complete:** the real shared helper was tested with fake side-effecting leaves, preserving production ordering, awaits, merge precedence, and plugin-registry ownership. The existing full integration test remains unchanged. This does not initialize the real runtime.
3. **Remaining evidence gap:** current source-to-artifact provenance is unavailable under the current no-build policy. Real runtime-context initialization, package qualification, and provider/integration behavior remain separate and unproven.
4. A maintainer must make a delivery/integration decision before any build, commit, provider call, or full runtime initialization. This result authorizes no review PASS, push, SDD restart, package qualification, or WP00 closure.

## Evidence anchors

<!-- evidence:begin -->
- [read] The runtime configuration defines legacy default, explicit worker mode, allowlisted environment, and five-field compatibility matching. src=src/core/mcp-runtime-config.ts:1-171
- [read] The protocol defines closed v1 envelopes, stable error codes, bounded JSON, manifest/security validation, and live request IDs. src=src/mcp-builder/plugin-runtime-protocol.ts:1-278
- [read] The host waits for observed worker exit on import termination, bounds invocation/diagnostic output, and quarantines terminal workers. src=src/mcp-builder/plugin-runtime-host.ts:90-327
- [read] The loader hashes the worker entry and complete regular plugin root before worker admission, then transfers ownership to the registry. src=src/mcp-builder/loader.ts:145-270
- [read] The zero-argument production wrapper supplies real leaves to the type-only composition helper, while the helper owns the awaited ordering and returned merge. src=src/bootstrap/runtime-context.ts:1-23
- [read] The composition helper has only type imports and owns the foundation/features/local/support/registry sequence. src=src/bootstrap/runtime-composition.ts:1-94
- [read] The archived verification report records the qualified PASS scope. src=openspec/changes/archive/2026-09-09-plugin-runtime-cancellation/verify-report.md:17-24
- [read] The archived verification report records execution identity and explicit limitations. src=openspec/changes/archive/2026-09-09-plugin-runtime-cancellation/verify-report.md:34-49
- [read] The archived verification report records the non-production qualification limits. src=openspec/changes/archive/2026-09-09-plugin-runtime-cancellation/verify-report.md:111-115
- [read] The retained deployment guide requires actual package bytes and states that fixture qualification is not production-root qualification. src=docs/plugin-runtime-cancellation.md:1-13
- [read] The retained deployment guide records package acceptance and qualification limitations. src=docs/plugin-runtime-cancellation.md:94-118
- [executed] A read-only SHA-256 recomputation matched all 27 current candidate path rows and confirmed the registry hash above. cmd=`python3` hash-validation script exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] A read-only path inventory enumerated the excluded containment OpenSpec, archived OpenSpec, canonical-spec, and audit-control files. cmd=`fd --type f` path inventory exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] Read-only worktree state was inspected. cmd=`git status --short --branch` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] Current candidate base was inspected. cmd=`git rev-parse HEAD` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] The exact 27-overlay patch, hashes/modes, patch re-application, and protected repository pre/post manifest comparison were recorded. cmd=`git archive ee9e7d2; git diff --numstat; git apply --check` exit=0 cwd=`/tmp/plugin-runtime-slice-verify-z94sS0`
- [executed] Authorized no-emission tests passed 39/39 and no-emit typechecking passed in the isolated Node 22 snapshot. cmd=`node --import tsx --test <six focused files plus selected diagnostics name pattern>; /work/node_modules/.bin/tsc --noEmit` exit=0 cwd=`/work/.plugin-runtime-slice-verify-z94sS0/snapshot`
- [read] The later retained TAP records one passed and four failed worker cases, with `WORKER_EXITED` reported for the failures. src=/tmp/plugin-runtime-worker-verify-xjdwuN/logs/worker-five.log:3-90
- [read] The later retained proof records exact patch identity, protected repository preservation, the unrecorded numeric exit caveat, and the decision not to run the sixth case. src=/tmp/plugin-runtime-worker-verify-xjdwuN/proof.json:1-53
- [read] The separate first-case probe records the exact command, numeric exit 1, one error/zero stderr/one exit event counts, unchanged canonical source/protected repository, and the then-proposed test-only correction. src=/tmp/worker-startup-probe-4w1kwgc3/artifacts/proof.json:1-83
- [read] The scratch observer records the ReferenceError, the nearest type=module package scope, and CommonJS/no-ESM-syntax emitted worker/protocol bytes. src=/tmp/worker-startup-probe-4w1kwgc3/artifacts/worker-observation.json:1-54
- [executed] The corrected emitter’s emit-only preflight, full five worker cases, focused real-worker diagnostics case, and typecheck all passed once. cmd=`node --import tsx emit-only-probe.ts; node --import tsx --test test/mcp-builder/plugin-runtime-worker.test.ts; node --import tsx --test --test-name-pattern '^bounds real worker events and the shared lifetime while draining both streams$' test/mcp-builder/plugin-runtime-diagnostics.test.ts; /work/node_modules/.bin/tsc --noEmit` exit=0 cwd=`/work/.runtime-emitter-fix-2h3e7y5k/candidate`
- [executed] The normalized repository-relative delivery patch passed diff check, apply check, application, and all 27 overlay byte/mode comparisons. cmd=`git diff --check; git apply --check; git apply` exit=0 cwd=`/tmp/runtime-emitter-fix-2h3e7y5k`
- [executed] The isolated composition helper passed its two focused tests and typechecking in a fresh HEAD-plus-27-overlay scratch candidate; all non-owned bytes/modes matched before and after. cmd=`node --import tsx --test test/bootstrap/runtime-composition.test.ts; /work/node_modules/.bin/tsc --noEmit` exit=0 cwd=`/work/.runtime-composition-fixed-20260910`
- [executed] The 3-path composition patch applied to a separate HEAD-plus-27-overlay scratch tree and matched the candidate bytes. cmd=`git apply --unsafe-paths --directory=<scratch> runtime-composition-3path.patch` exit=0 cwd=`/tmp/runtime-composition-correction-20260910`
<!-- evidence:end -->

## Parent handoff

**status:** focused source-level worker fixture verification passed. Historical 39/39 and 1/5 receipts remain separate; the corrected full worker gate passed 5/5, the focused real-worker diagnostics gate passed 1/1, and typecheck passed. The isolated runtime-composition seam also passed 2/2 and typecheck; package qualification and real runtime-context initialization remain unexecuted.

**executive_summary:** Runtime implementation is present across the historical 27-path prerequisite snapshot plus a 3-path composition delta that shares runtime-context, yielding 29 owned paths. The directly measured full union is 3,325 additions/137 deletions (3,462 changed lines). The ledger assigns U1=629/0, U2=845/23, U3=1,344/114, and U4=507/0; all four cohesive units remain over budget when tests/docs stay with behavior.

**artifacts:** `docs/audit/2026-09-01/delivery-slice-plugin-runtime.md`; minimal updates to `docs/audit/2026-09-01/roadmap-current.md` and `docs/audit/2026-09-01/wp00-progress-current.md`.

**exact_independence_conclusion:** The historical 39/39, 1/5, and first-case probe receipts remain distinct. The historical 27-path prerequisite snapshot has fresh 5/5 worker, 1/1 real-worker diagnostics, and typecheck proof; the follow-on composition delta adds isolated 2/2 plus typecheck proof and applies only after that snapshot. The composed candidate has no installed-package, current-tarball, clean-install, populated-runtime, or full runtime-initialization qualification proof.

**review_workload_forecast:** High 400-line risk; 3,462 directly measured changed lines. Chained PRs are a future delivery decision, or a single PR needs an explicit new size exception. The archived size-exception/single-PR choice is not reused as current consent.

**risks:** mixed dirty worktree; the fixture mismatch is fixed at test-helper scope and composition ordering is isolated, but package, populated runtime, real runtime-context initialization, clean-install, and cross-platform coverage remain unproven. Retained package availability is not qualification; archive limitations remain binding.

**next_recommended:** Stop functional verification. The approved test-only emitter correction, retained historical package-identity inventory, and isolated runtime-composition work are complete. The remaining gaps are current source-to-artifact provenance and a maintainer delivery/integration decision; do not automatically build, commit, call providers, initialize the real runtime, reopen archived SDD, or infer review PASS or WP00 closure.

**skill_resolution:** paths-injected: `/home/javier/.agents/skills/typescript/SKILL.md`, `/home/javier/.agents/skills/cognitive-doc-design/SKILL.md`, `/home/javier/.agents/skills/evidence-grading/SKILL.md`, `/home/javier/.agents/skills/work-unit-commits/SKILL.md`, `/home/javier/.agents/skills/chained-pr/SKILL.md`.
