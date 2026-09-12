# HEALTH-REGISTRY reconciliation

## Current status

The final C1 startup exact-set candidate is **narrowly admitted** as a single 69-path, 17/17 focused receipt for the four-theme aggregate: **post-local freeze**, **duplicate**, **required**, and **late register**. The selected rule is unchanged: all 17 built-in canonical adapter registrations are required after alias normalization, while a local provider is optional. Membership is registration identity only, not a credential or availability check.

The core/post-local lifecycle and the HTTP/MCP startup guards are implemented. Fifteen existing HTTP/MCP fixtures now use a real Router completed only with inert missing builtin registrations and frozen through the production lifecycle. **All fifteen distinct fixture files have now been invoked** under bounded consents: the earlier loopback, whole-file, StubAdapter, and CORS/local-LLM receipts, the three-fixture discovery-DI receipt, and the final MCP-builder receipt. A separate filtered-projection receipt now proves a bounded shared MCP/HTTP startup, health, and tool-list boundary; it is not a replacement for C1. C1 admits only the four named aggregate themes; it is not “10/10” or ten independently qualified scenarios, and neither C1 nor the new receipt establishes full HTTP/MCP integration, provider/network/credential/package qualification, original-worktree bootstrap qualification, whole-worktree or source-to-package provenance, or WP00 closure.

## Implemented lifecycle and boundary

| Step | Current behavior | Evidence boundary |
|---|---|---|
| Core validation and freeze | Required IDs and canonical duplicates are validated atomically; the registry then freezes and rejects mutation. | Fake-provider core tests; no availability probes. |
| Post-local composition | Composition freezes after optional local bootstrap and before support/context assembly. | Injected composition dependencies. |
| HTTP/MCP entry | Each startup function first asserts a frozen Router before reading later dependencies or assembling resources. | Real Router plus throw-on-read dependency proxy. |
| Fixture adaptation | `freezeRouterForStartup` preserves existing provider references/order, supplements only missing normalized builtin IDs with inert unavailable providers, and calls the real freeze lifecycle. | Test helper only; no adapter, credential, or provider call. |

## Executed startup evidence

The initial guard RED was retained: unfrozen HTTP and MCP routers reached a dependency sentinel, demonstrating the absent guard before implementation. The final focused command ran four suites and passed **17/17**; canonical `tsc --noEmit` also exited 0. The startup test's final correction strengthens the fixture oracle with an independent literal normalized set of all 17 IDs; it retains the prior count, reference, order, alias, and availability assertions.

- Final proof: `/tmp/health-registry-startup-exact-set-final-20260910/artifacts/proof.json`, SHA-256 `6ffa38f609c8b7bde13bceb6a20e653f536d28b7fff196025f9565db278d90de`.
- Final one-file oracle correction: SHA-256 `6918fb86a36e363196460c847dd45d638d325bd39444e12dfd264cfdb597e18a`, layered on the 19-path startup patch SHA-256 `d0cc917e320c60ed97ebd3c03ddebeb3da3a52044347c0c5ef286135caf995b8` (`+230/-47` from true preimages).
- The preceding startup proof `2889e33a07ee19d1a977c801ec266ef7c845e3b5c2e037d72da8487b48b5ebb0` remains historical guard/helper/migration evidence. The final candidate has 69 mode/byte-identified paths; the one-file correction changed its startup test and retained 68 prior rows unchanged.
- The earlier 53-path core/post-local receipt remains separate historical evidence; neither it nor the 69-path identity is a same-size suite run.

## Bounded disposable zero-argument bootstrap receipt

One bounded disposable, no-network, zero-argument bootstrap receipt is now recorded. It used Node `v22.23.2` with ABI `127`; the rebuilt `better_sqlite3.node` was injected only into a temporary physical pnpm target. Readiness reached `MCP server started on stdio`; the application and wrapper both exited `0`; duration was `3.946s`; stdout contained `0` bytes. Cleanup completed with no residual process.

- Summary proof SHA-256: `d79605a2f57d2d26814c35f5116b2d9f8d923b285084888ca12d6a9925002f37`.
- Stderr proof SHA-256: `f86b3e87bcc1c43c79329978a59bdc7e67017d47253afcce987249648cd420e9`.
- The original worktree's physical pnpm binding remains absent and unmodified. This receipt proves only the disposable rebuilt-artifact candidate; it does not qualify the original worktree or production/package context.

## Consented two-fixture integration qualification

The user explicitly consented to only `test/http-comparison.test.ts` and `test/http-three-part-prompt.test.ts`. In the existing offline container, the isolated command used `env -i`, an owned empty `HOME` and `TMPDIR`, and `LLM_GATEWAY_BIND_HOST=127.0.0.1`. It executed temporary SQLite/TestVault state and real ephemeral HTTP loopback listeners without secret-file use, external providers, or persistent/project data. The retained TAP log records **18/18 tests in five suites**; owned temporary-resource inventories were empty after cleanup and no residual test process remained. This receipt is distinct from the prior focused **17/17 in four suites plus `tsc --noEmit`** receipt; it did not rerun typechecking or the entire 69-path candidate suite.

- Final integration proof: `/tmp/health-registry-http-integration-20260910/artifacts/proof.json`, SHA-256 `bb4325746f2a91153769291a0bd211218b6a0b41243ac76561110a6a12a56cf6`.
- Integration log SHA-256: `3d7ebdbd6f8aa50a8d570b43e4f7a5b8b3732f9bfb8f874d4826e7671dadb26b`.
- Candidate identity: all 69 current source/test path bytes and modes remained unchanged before and after the run.

## Consented four-fixture qualification

A separate user consent authorized only `test/http-cost.test.ts`, `test/http-analytics.test.ts`, `test/http-metrics.test.ts`, and `test/bootstrap/plugin-runtime-lifecycle.test.ts`. The sequential isolated command passed **49/49 tests in 16 suites**, with no skipped tests and exit 0. It used the existing offline Node 22 container with `env -i`, minimal PATH, owned HOME/TMPDIR, `NODE_ENV=test`, and `LLM_GATEWAY_BIND_HOST=127.0.0.1`; credential filename checks were empty. The retained cleanup evidence is limited to owned HOME/TMPDIR emptiness and zero residual Node test processes after removing the owned `tsx-0` cache. It does not claim container-wide temporary-database cleanup.

- Final proof: `/tmp/health-registry-four-fixture-final-20260910/artifacts/proof.json`, SHA-256 `5915114d79ea2441b03b4d0520313f05fd18e8576067c2844f697ce4e98ce62b`.
- TAP log: `/tmp/health-registry-four-fixture-final-20260910/artifacts/focused.log`, SHA-256 `55e49e75dbd58ad9aa0c6a2da78e2e990bd522b44354908d34aa04f0eeac5690`.
- This is a third distinct receipt: it does not rerun or replace the earlier 18/18 two-fixture run, nor the earlier 17/17 four-suite startup receipt with `tsc --noEmit`.

## Consented StubAdapter fixture qualification

A later separate consent authorized only `test/http-middleware.test.ts`, `test/http.test.ts`, `test/http-logs.test.ts`, and `test/admin.test.ts`. Their existing `createAllAdapters` registration loops were replaced by the existing deterministic `StubAdapter`; the real `Router`, `freezeRouterForStartup`, and all existing assertions remained in use. The isolated command passed **109 of 110 tests in 50 suites**, with **0 failures** and **1 pre-existing skip**: `test/http.test.ts:518` still skips `OPTIONS request returns CORS headers`. Canonical `tsc --noEmit` exited 0.

- Final proof: `/tmp/health-registry-stub-adapters-final-20260910/artifacts/proof.json`, SHA-256 `bb6c9784352b5ab83a2a5844caec31908148114f16356f9e218d7f44c946846d`.
- Four-path fixture patch: SHA-256 `e0a1debd767e11c9c743c358df2cf0f29ea02752eba838a375349aac677e5f0a`; current 69-path manifest: SHA-256 `0b054fdbc3c1cdd67a9349940484b3fc88d766c04dca49af7089cfbd607a34b2`; TAP log: SHA-256 `ab1ef0d11d007ac94aee7e17c89733e4c0eef0c7895fa0f0dcc15d0471c89f26`.
- The initial host redirection error occurred before `docker exec`, so it was not a product test failure. The final command used a host Python argv runner with `shell=False`; 65 nonowned manifest paths remained byte/mode-identical, and the owned temporary HOME/TMPDIR cleanup left no matching fixture DB/WAL/SHM or residual test process.

## CORS/local-LLM fixture correction

A later authorization covered only `test/http.test.ts` and `test/http-local-llm.test.ts`. The isolated Node 22 command passed **33/33 tests in 18 suites**, with no skipped tests; canonical `tsc --noEmit` also exited 0. It changed only these two test files: the CORS fixture now pins an explicit allowed origin before server construction and asserts exact allowed PATCH and denied-origin preflight contracts; the local-LLM fixture pins `127.0.0.1`, restores `LOCAL_LLM_ENABLED`, and uses an independent safe-error/redaction oracle for its two disabled backends. The public `readyReason` remains `Local LLM is disabled by runtime flag`.

- Final proof: `/tmp/http-cors-local-correction-final-20260910/artifacts/final-proof.json`, SHA-256 `476b0058f252bd9c2c90c834442d42d15d9daaf557075f4985eee62763a484e1`.
- Final TAP log SHA-256: `7a89010e4da163d8ff60bdb084748402bd440bd1ea273ba782ad5ab1dc4d7756`; final 69-path manifest SHA-256: `0141a25ac2ddbd2011dec59bb35a2598a345a918428e7bfee02fa01cc13d72c8`; 67 nonowned paths were unchanged.
- The immutable first attempt remains historical: it passed 32/33 before the stale local oracle was corrected. Its pre-Node Python launcher syntax error is harness history, not a product regression. The final combined delivery patch is `combined-2path-true-initial-preimage.patch`, SHA-256 `386951b83e693f349e8e0c2f6200e924d022561e6f411d76d928f1caba3ea9e8`.

## Consented discovery-DI fixture qualification

A fifth bounded consent qualified `test/admin-discovery.test.ts`, `test/integration/wiring-sprint.test.ts`, and `test/e2e/full-pipeline.test.ts` through the optional object-style startup DI forwarded by `startHttpServerWithDeps` into `http-app.ts` and then `admin.ts`. The fixtures use typed fakes for discovery/local-model services while preserving the real Router/freeze lifecycle. The final run passed **23/23 tests in seven suites**, with no skips; canonical `tsc --noEmit -p tsconfig.json` exited 0. The corrected environment added only `OLLAMA_URL=http://127.0.0.1:11434` and `LM_STUDIO_URL=http://127.0.0.1:1234` to satisfy the fake URL contract; these are loopback configuration values, not provider connections. No global fetch or provider probe was used.

The preceding 6xHTTP-500 run is retained as separate harness evidence: the fakes expected `127.0.0.1` while omitted variables made production defaults `localhost`; it was not a production failure. The full runtime candidate materialized only current `src/`, `test/`, `package.json`, and `tsconfig.json` (656 entries; tar SHA-256 `681cc1f044717496ac0beae7e5febd56e7c382a0ea5af110eb8a37e6dd774cba`), not the whole worktree. Final proof SHA-256 is `cf6a96e21c313eeb2ff158cb33f60cba1b0c1a7b351817ae0b429ae1c58e9831`; TAP log SHA-256 is `1126c203e911a9ac42b226f87332d454909267988f70e29ce99892dd339dab0d`.

## Consented MCP-builder fixture qualification

The final bounded consent qualified `test/e2e/mcp-builder-integration.test.ts` after a test-only lifecycle, diagnostic-oracle, and nullability correction. The correction keeps real `StdioServerTransport`, legacy dynamic imports, generated-module execution, delayed/hung timeout, and quarantine behavior; it only makes the fixture's owned temporary state, environment/CWD restoration, close ordering, safe public error assertions, and `server = undefined` cleanup type-safe. The isolated run passed **14/14 tests in three suites**, with no skips; canonical `tsc --noEmit -p tsconfig.json` exited 0. Teardown closes the server before Vault, restores CWD, removes owned `vault.db`/`-wal`/`-shm` and plugin/shadow directories, and leaves no owned resources or Node process.

The full runtime materialization contained only `src/`, `test/`, `package.json`, and `tsconfig.json` (657 entries; tar SHA-256 `122da372ccd1125c3a5204120083bdbbd264ec17b780e2bb13c70ec032b49b9e`), not the whole worktree. Final proof SHA-256 is `a58f3c7a990647be927874573814d487d399600e2e84ed626e7d0df72ed462b4`; TAP SHA-256 is `3f233dfdb814e88d2ecb72526624ee6bf918729e9aeee53c550ab36e84075611`. The one-file candidate SHA-256 is `31eb172d1d1a9c2490b24f6cdd9d22f61bf96d9631cfd1727ed2aabd61c46948`; the nullability correction patch is `b47c98d44a9bc96e8a56d1e707c46cdf4c96a693cb3b8452f03e3c16f25c95c3`, layered on combined initial patch `37a43f1b41a4de00a1f066d8e5d0d95149f847c72d6db5a67c2fd3d7192784a9`. Earlier 9/14 and 14/14-plus-typecheck failures remain historical harness/oracle stages, not production failures.

### Migrated fixture qualification inventory

| Execution state | Fixture paths |
|---|---|
| Executed under the first bounded consent (2) | `test/http-comparison.test.ts`; `test/http-three-part-prompt.test.ts` — 18/18 tests in five suites; retained separately below. |
| Executed under the second bounded consent (4) | `test/http-cost.test.ts`; `test/http-analytics.test.ts`; `test/http-metrics.test.ts`; `test/bootstrap/plugin-runtime-lifecycle.test.ts` — 49/49 tests in 16 suites, exit 0, with no skipped tests. |
| Invoked under the third bounded consent (4; historical partial file qualification) | `test/http-middleware.test.ts`; `test/http.test.ts`; `test/http-logs.test.ts`; `test/admin.test.ts` — 109/110 tests in 50 suites, 0 failures, 1 pre-existing skip, and `tsc --noEmit` exit 0. The historical `http.test.ts` CORS `OPTIONS` skip was resolved only in the later two-file receipt. |
| Executed under the fourth bounded consent (2; one newly invoked fixture) | `test/http.test.ts`; `test/http-local-llm.test.ts` — 33/33 tests in 18 suites, no skips, plus `tsc --noEmit` exit 0. This resolves the CORS skip and qualifies the local fixture's bounded disabled-mode behavior, but response output alone does not prove no probing. |
| Executed under the fifth bounded consent (3) | `test/admin-discovery.test.ts`; `test/integration/wiring-sprint.test.ts`; `test/e2e/full-pipeline.test.ts` — 23/23 tests in seven suites, no skips, plus canonical `tsc --noEmit`; typed fakes and optional object-style startup DI were exercised through the real HTTP server lifecycle. |
| Executed under the final bounded consent (1) | `test/e2e/mcp-builder-integration.test.ts` — 14/14 tests in three suites, no skips, plus canonical `tsc --noEmit`; real Stdio/dynamic-import and timeout/quarantine behavior were retained with owned cleanup. |

## Bounded filtered-projection HTTP/MCP integration receipt (2026-09-11)

One separate, single-run receipt passed in the Linux x64/glibc local image `mcp-llm-bridge-wp00-native:local-20260911T153426Z` (`sha256:855cac4d86039b612e453d2b4a64f789aaff17a5c04b39444afc4ae121444bfa`). The image supplied Node `22.23.2`, ABI `127`, and its image-native `better-sqlite3` dependency tree. An offline (`network=none`), read-only, non-root source projection at `/opt/mcp-llm-bridge-native/receipt-repo` contained 291 regular files; host `node_modules` and secrets were excluded, and the projection was removed afterward. MCP connected, `tools/list` was invoked exactly once, and 30 tools were returned. The first local health poll returned HTTP 200 with `status: ok`, version `0.6.0`, authentication disabled, 17 total/0 available providers, Anthropic `none`, and `mode: proxy`.

The receipt also records unchanged repository HEAD/status and docs configuration, with proof persisted at `/tmp/wp00-filtered-receipt-bhf93fos/`. The initial checksum-cwd issue was harness bookkeeping corrected before proof verification, not a product failure. This is a separate bounded integration receipt following the prior C1 four-theme admission; it proves only the shared MCP/HTTP startup, health, and tool-list boundary. It does not claim full HTTP/MCP integration, all tool behavior, provider availability or credentials, network qualification, original host binding, clean package provenance, multi-platform evidence, delivery, WP00 closure, or a 10/10 scenario result.

<!-- evidence:begin -->
- [read] The MCP client connected, tools/list ran once, and 30 tools were returned. src=/tmp/wp00-filtered-receipt-bhf93fos/receipt-result.json:2-6
- [read] The first health poll returned HTTP 200 with the recorded status, version, auth, provider, subscription, and mode fields. src=/tmp/wp00-filtered-receipt-bhf93fos/receipt-result.json:39-60
- [read] The filtered projection selection, source repository, credential scan, and required local image identity are recorded. src=/tmp/wp00-filtered-receipt-bhf93fos/projection-manifest.json:2-6,1171-1176
- [read] Cleanup records projection removal and container auto-removal. src=/tmp/wp00-filtered-receipt-bhf93fos/cleanup.json:2-8
- [read] The complete receipt artifact set and hashes are persisted under the bounded proof directory. src=/tmp/wp00-filtered-receipt-bhf93fos/SHA256SUMS:1-14
<!-- evidence:end -->

## Persistent Dev Container MCP/HTTP receipt (2026-09-11)

The persistent reviewed Dev Container harness passed `pnpm run test:wp00:devcontainer` with exit 0. Within that run, MCP `tools/list` returned **30 tools** and no MCP `tools/call` occurred; loopback `/health` returned HTTP 200 with `status: ok`. This receipt is additive to, and distinct from, the earlier filtered-projection receipt: it records the persistent harness mechanism rather than replacing the filtered projection's bounded source-materialization scope.

The already documented runtime boundary remains: public pinned image, `network=none`, `node` user, and isolated workspace dependencies. The runner emitted JSON on stdout but did not report a filesystem receipt path, so no new artifact locator, image digest, or receipt path is asserted here.

This receipt may include contained availability checks. It does not establish real provider calls, generation/provider readiness, external network behavior, cross-platform support, provenance or signing, delivery, or WP00 closure. The absence of `tools/call` also means tool execution behavior was not exercised.

<!-- evidence:begin -->
- [executed] The persistent reviewed Dev Container harness passed the bounded MCP/HTTP check. cmd=`pnpm run test:wp00:devcontainer` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
<!-- evidence:end -->

## Remaining acceptance gap

Implementation, fixture migration, and six distinct bounded qualifications are complete. **All fifteen of fifteen fixture files have been invoked.** The discovery fixtures are verified through optional object-style startup DI with typed fakes, and the MCP-builder fixture is verified through its test-only lifecycle correction with real Stdio/dynamic behavior. The separate filtered-projection receipt additionally proves a bounded shared MCP/HTTP startup, health, and tool-list boundary. The single C1 candidate is a 69-path, 17/17 focused receipt and directly admits only **post-local freeze**, **duplicate**, **required**, and **late register**. It is not “10/10” or ten independently qualified scenarios, and these receipts do not establish full HTTP/MCP integration, provider/network/credential/package qualification, original-worktree bootstrap qualification, whole-worktree or source-to-package provenance, or WP00 closure. No broader aggregate admission follows; do not reopen the completed fixture slices automatically.

## Aggregate admission criteria

The aggregate evidence themes are exactly: **post-local freeze**, **duplicate**, **required**, and **late register**. The following receipt matrix is the required documentation shape at aggregate-theme granularity:

| Aggregate theme | Candidate identity and bounded materialization | Separate receipt identity | Asserted behavior | Observed result | Proof/hash references |
|---|---|---|---|---|---|
| post-local freeze / duplicate / required / late register | Candidate paths, bytes/modes, and explicit materialization boundary | Distinct receipt name or identifier | Behavior asserted by the candidate | Direct observed outcome | Proof, log, manifest, and/or hash references |

An aggregate theme is candidate-bound only when its row contains direct evidence for the named candidate and all required receipt fields. C1 is the single final startup exact-set candidate: one 69-path, 17/17 focused receipt. It directly proves all four named themes—**post-local freeze**, **duplicate**, **required**, and **late register**—so this four-theme aggregate is **narrowly admitted**. This does not admit “10/10” or ten independently qualified scenarios, and it does not establish full HTTP/MCP integration, provider/network/credential/package qualification, original-worktree bootstrap qualification, whole-worktree or source-to-package provenance, or WP00 closure.

`HEALTH-REG-01..10` MUST NOT be treated as ten independently-defined scenarios, and this document MUST NOT claim “10/10”. The current MCP-builder receipt's 657-entry materialization is limited to `src/`, `test/`, `package.json`, and `tsconfig.json`; it is not whole-worktree provenance.

### Future evidence gates (not executed)

- Original-worktree and production/package qualification of the zero-argument bootstrap.
- Complete HTTP/MCP integration.
- Provider/network/package qualification.
- Full-worktree provenance.
- WP00 closure.

## Historical reconciliation context

Before the selected built-in-17/local-optional decision, this document recorded a configured-subset alternative. That decision is resolved; earlier read-only observations remain history. `HEALTH-REGISTRY-STUB-01` remains separately named at DAG line 331 and is not one of aggregate `HEALTH-REG-01..10`.

<!-- evidence:begin -->
- [read] HTTP startup asserts the frozen registry before configuration/resource work. src=src/server/http.ts:58-61
- [read] MCP startup asserts the frozen registry before option destructuring/server construction. src=src/server/mcp-server.ts:281-284
- [read] The test-only helper normalizes existing IDs, adds only missing builtins, and calls the real freeze method. src=test/helpers/frozen-router.ts:23-36
- [read] Startup tests cover unfrozen zero-other-dependency reads, frozen sentinel reachability, and the independent normalized membership oracle. src=test/wp00/health-registry-startup.test.ts:70-132
- [executed] Final focused startup verification passed. cmd=`timeout 60s node --import tsx --test test/wp00/health-registry.test.ts test/wp00/health-registry-startup.test.ts test/bootstrap/runtime-composition.test.ts test/bootstrap/server-startup.test.ts` exit=0 cwd=`/work/.health-registry-startup-green-20260910`
- [executed] Final no-emit typecheck passed. cmd=`/work/node_modules/.bin/tsc --noEmit -p tsconfig.json` exit=0 cwd=`/work/.health-registry-startup-green-20260910`
- [executed] The first consented integration command passed 18/18 TAP tests in five suites under `env -i`, owned HOME/TMPDIR, and `LLM_GATEWAY_BIND_HOST=127.0.0.1`. cmd=`/usr/bin/timeout 90s node --import tsx --test test/http-comparison.test.ts test/http-three-part-prompt.test.ts` exit=0 cwd=`/work/.health-registry-startup-green-20260910`
- [executed] The second consented batch passed 49/49 TAP tests in 16 suites with no skips. cmd=`/usr/bin/timeout 120s node --import tsx --test --test-concurrency=1 test/http-cost.test.ts test/http-analytics.test.ts test/http-metrics.test.ts test/bootstrap/plugin-runtime-lifecycle.test.ts` exit=0 cwd=`/work/.health-registry-startup-green-20260910`
- [read] The retained proof records the sanitized environment, empty credential filename checks, 69-path identity, and empty owned HOME/TMPDIR plus zero residual Node test processes after cleanup. src=/tmp/health-registry-four-fixture-final-20260910/artifacts/proof.json:1
- [executed] The StubAdapter fixture batch passed 109/110 tests in 50 suites with one pre-existing skip and `tsc --noEmit` passed. cmd=`node --import tsx --test --test-concurrency=1 test/http-middleware.test.ts test/http.test.ts test/http-logs.test.ts test/admin.test.ts` exit=0 cwd=`/work/.health-registry-stub-adapters-final-20260910`
- [read] The final StubAdapter proof records 69-path identity, 65 unchanged nonowned paths, cleanup, and the historical pre-Docker redirect failure. src=/tmp/health-registry-stub-adapters-final-20260910/artifacts/proof.json:1
- [executed] The final CORS/local-LLM command passed 33/33 TAP tests in 18 suites with no skips, and no-emit typechecking passed. cmd=`node --import tsx --test --test-concurrency=1 test/http.test.ts test/http-local-llm.test.ts` exit=0 cwd=`/work/.http-cors-local-final-20260910`
- [read] The final proof records the historical 32/33 failure, exact final command/logs, 67 unchanged nonowned paths, and no-Node postflight check. src=/tmp/http-cors-local-correction-final-20260910/artifacts/final-proof.json:1
- [executed] The final discovery-DI qualification passed 23/23 tests in seven suites and canonical `tsc --noEmit`; optional object-style startup DI, typed fakes, loopback URL configuration, and no-provider/no-global-fetch boundaries were exercised. cmd=`env -i ... /usr/bin/timeout 120s node --import tsx --test --test-concurrency=1 test/admin-discovery.test.ts test/integration/wiring-sprint.test.ts test/e2e/full-pipeline.test.ts` exit=0 cwd=`/work/.http-discovery-di-fullbase-20260910-05`; proof=/tmp/http-discovery-di-fullbase-20260910-05/artifacts/final-proof.json:1; log=/tmp/http-discovery-di-fullbase-20260910-05/artifacts/discovery-di-tests.stdout.log:1; tar=/tmp/http-discovery-di-fullbase-20260910-05/artifacts/fullbase-tar.json:1
- [read] The preceding six HTTP 500s were test-environment localhost/127.0.0.1 fake-contract mismatches, not a production failure; the corrected run added only `OLLAMA_URL` and `LM_STUDIO_URL` loopback values. src=src/core/local-llm-env.ts:7-10; tests=test/admin-discovery.test.ts:22-43
- [executed] The final MCP-builder qualification passed 14/14 tests in three suites with no skips and canonical `tsc --noEmit -p tsconfig.json`; real Stdio/dynamic imports, timeout/quarantine cases, and owned teardown were retained. cmd=`env -i ... timeout 120s node --import tsx --test --test-concurrency=1 test/e2e/mcp-builder-integration.test.ts` exit=0 cwd=`/work/.mcp-builder-null-correction-fullbase-20260910-01`; proof=/tmp/mcp-builder-null-correction-final-20260910-01/artifacts/final-proof.json:1; tap=/tmp/mcp-builder-null-correction-final-20260910-01/artifacts/mcp-builder.tap.log:1
- [read] Final MCP-builder materialization contained 657 paths rooted at `src/`, `test/`, `package.json`, and `tsconfig.json`; container path/hash/mode inventory matched exactly, with no mounts or networks. tar=/tmp/mcp-builder-null-correction-final-20260910-01/artifacts/fullbase-tar.json:1
<!-- evidence:end -->
