# WP00: current progress and the next bounded production work

WP00 has delivered verified components and storage, execution, observability and administrative error-containment fixes, but it is not closed.
The `plugin-runtime-cancellation` change is archived as historical work; the additive diagnostics view is source-level and in-process. Its bounded delivery inventory and fresh isolated selective-snapshot proof are recorded in [`delivery-slice-plugin-diagnostics.md`](delivery-slice-plugin-diagnostics.md), and its five-file slice is locally committed as `ee9e7d2` but not published; remote merge was not inspected. The remaining runtime candidate is inventoried in [`delivery-slice-plugin-runtime.md`](delivery-slice-plugin-runtime.md). Its historical 39/39 no-emission and 1/5 worker receipts remain separate. The confirmed fixture-emission/module-context mismatch is fixed only in the test helper by virtual `.mts` NodeNext metadata; fresh Node 22 verification passed worker 5/5, focused real-worker diagnostics 1/1, and `tsc --noEmit`. The real runtime-composition helper has a completed isolated 2/2-plus-typecheck receipt with fake leaves, while its initial typecheck import defect remains retained as historical evidence. The directly measured composed union is 29 paths, `+3,325/-137 = 3,462` changed lines. A completed read-only inventory verified historical retained-package identity in the approved offline container, but did not establish current-candidate artifact provenance. Package qualification and real runtime-context initialization remain excluded. Neither result closes WP00 or authorizes a new scanner, signer, identity system, review PASS, commit, or delivery.
The gateway deleted-cwd settings-path correction is a three-file locally committed delivery slice in [`delivery-slice-gateway-cwd.md`](delivery-slice-gateway-cwd.md), freshly functionally verified in isolation as `87ecd78` but not published; other pre-merge setup boundaries remain unverified.
This report separates implemented behavior from the evidence still required for canonical unit closure. SCAN-ROOT-API now has a bounded isolated proof; it is recorded below as scoped verification, not scanner, provider, or WP00 closure.

Macro reconciliation board: [`roadmap-current.md`](roadmap-current.md). The current per-unit guide is [`tasks.md#current-68-unit-guide`](../../../openspec/changes/containment-and-evidence-harness/tasks.md#current-68-unit-guide): it preserves the historical checklist while naming each unit's current evidence scope and acceptance gap. Reconciliation, fresh functional verification, the local gateway delivery commit, and the local diagnostics delivery commit are complete. This does not close WP00 or change the canonical SDD checklist.

## Snapshot and evidence boundaries

- Reconciliation date: **2026-09-09**; the directory retains the original audit date.
- Archived change: [`openspec/changes/archive/2026-09-09-plugin-runtime-cancellation`](../../../openspec/changes/archive/2026-09-09-plugin-runtime-cancellation) — **13/13 tasks, 10/10 requirements, 24/24 scenarios, 71/71 tests**. This is a historical archive, not a renewed WP00 completion claim.
- Additive diagnostics: `getDynamicPluginDiagnostics()` is a source-level in-process projection from `src/server/mcp.ts`; it reports `enabled`, `loaded`, and allowlisted diagnostic-code counts without raw paths, plugin/tool names, or messages. `getDynamicPluginLoadSummary()` remains the raw, compatibility-preserving legacy view. Actual MCP tool names are unchanged; no HTTP route or npm/package export is claimed.
- Historical source snapshot (2026-09-08): **`8db102a0`**, `fix(plugins): validate enumeration error shapes`.
- Historical Sep 8 verification: **57 targeted tests in four suites passed**, exit 0 in 504.048 ms for `8db102a0`; typecheck and normal commit hooks passed. The newest bounded diagnostics evidence is the locally committed slice documented below.
- Preceding loader catch-scope verification `9b987767`: **42 tests in three suites**, exit 0 in 336.532 ms; typecheck and normal hooks passed.
- Setup merge verification `e9453315`: **92 tests in 12 suites**, exit 0 in 3734.881 ms; typecheck and normal hooks passed.
- Earlier Vault audit verification `eb57de62`: **168 targeted tests across eight files and 24 suites**, exit 0 in 3032.180 ms; typecheck and normal hooks passed.
- The latest 57-test scope is not a rerun of the 168-test Vault, 92-test setup, 42-test loader or historical 1476-test aggregate. No totals are summed or renewed implicitly.
- Preceding gateway verification `2f6dc49`: **69 tests** = 19 new gateway + 27 gateway legacy + 15 Claude setup + 8 Claude setup legacy.
- Historical selected aggregates: price autosync `15fae347` (1398), Vault refresh `604a06b9` (1453), Claude setup `877537ac` (1476).
- The preceding `d6f8bfc2` snapshot recorded 1389 selected tests. These distinct scopes are not additive.
- Deliveries after report commit `318bc35f`: security logs `de8c39b` (1280), model autosync `8a16ac4` (1318), migration logs `3b030a7` (1368), OAuth sync logging `d6f8bfc2` (1389).
- Deliveries after report commit `7ededa72`: MCP `1745d565` (1161), HTTP characterization `37fbd076` (1190, test-only), ACP `f23bed01` (1245), partial plugin messages `8c4030ed` (1271).
- New scoped snapshots: circuit-breaker `7fe63bc0` (966), groups `f64b9cef` (1036), comparison history `eee7c8b4` (1084), comparison actions `694a842b` (1101), comparison validation `8249c3fc` (1130).
- The preceding tooling snapshot `1fd5d262` recorded 941 tests; these are successive, overlapping verification scopes.
- Recent scoped snapshots: sync actions `e98c308` (777), approvals `4d953903` (819), usage `d38cec3b` (845), metadata `b91f0a4` (868), costs `7884ed1b` (898), local models `fa48fb90` (911).
- Shell characterization `cbf2b70` has a separate 38-test result; it is test-only evidence, not a production fix or an additive snapshot.
- Earlier scoped snapshots: operations `d422a487` (621), discovery `51a010ef` (654), sync GET `a10ee2d` (719), sync validation `8bf9528f` (752).
- Successive snapshots overlap and must not be added together.
- All 11 previously recorded baseline failures were resolved through contract-aligned tests; none remain excluded in those runs.
- Those results were supplied by the isolated verification handoff; this documentation task did not rerun them.
- These counts are not the complete product suite and do not establish a whole-product pass.
- The canonical plan contains **68 units**, with 139 edges and 16 waves recorded in its DAG.
- Its eight checked rows are historical bookkeeping, not a current completion percentage; **8/68 is not a real progress percentage**.
- Recent implementation used the DIRECT route. It did not update historical SDD completion or attempt state.
- RDD remains disabled for this clone. No review approval is implied by implementation or functional verification.
- Unknown or unverified WP00 completion does not mean the corresponding product feature is absent.

The source reconciliation was bounded: plan, handoff, relevant commits, scanner modules/tests, and selected HTTP routes.
It was not a fresh audit of every historical foundation or all production code.

## Quick path

1. Keep the delivered gateway deleted-cwd settings-path correction bounded; remaining pre-merge setup failures are still unverified.
2. Keep internal registry filename/collision admission separate from scanner-issued diagnostic IDs and supply-chain authorization.
3. Preserve the archived worker scope and the delivered enumeration corrections; do not renew or relabel them as current closure.
4. Do not expand this step into scanner integration or unrelated identity-system changes. Resolve the real issuer and binding contract before any opaque ID wiring.

## Fresh bounded evidence

The following is the approved isolated Node 22 handoff, not a whole-product or scanner proof. The package lock matched cached dependencies; the execution environment/container had no attached network, egress, or mounts. The three per-file commands executed individually named test cases; they were not prior module-only runner results or a test-runner aggregate.

<!-- evidence:begin -->
- [executed] The diagnostics cases passed. cmd=`node --import tsx test/wp00/plugin-diagnostics.test.ts` exit=0 cwd=`repository root in isolated Node 22.23.2 snapshot`
- [executed] The loader cases passed. cmd=`node --import tsx test/wp00/err-plugin-loader.test.ts` exit=0 cwd=`repository root in isolated Node 22.23.2 snapshot`
- [executed] The registry cases passed. cmd=`node --import tsx test/mcp-builder/plugin-runtime-registry.test.ts` exit=0 cwd=`repository root in isolated Node 22.23.2 snapshot`
- [executed] The no-emit typecheck passed. cmd=`tsc --noEmit` exit=0 cwd=`repository root in isolated Node 22.23.2 snapshot`
<!-- evidence:end -->

These disjoint named cases total **23/23**: diagnostics 6, loader 11, registry 6. Snapshot hash: `15805fcc3e8a2d82341dc829dd18a3a0b0296ee91707b439d5baa2335322650b`. Log hashes: diagnostics `c0609e87834f241a1e5b3a1ef690db2fe521b4a6148c02a86754fc29ef0e3fe7`, loader `1bd8940a01ab119ed24ca07875c7e3370ab8327099aa856237090642dea56b59`, registry `b50d33d7995e3bbe82b5bf8eb9e1962ae4843099a38a6c06fc7d7d830a41aeb5`. This evidence does not add the distinct prior Node 25 six-case proof to these totals. No build was run.

## Diagnostics selective-snapshot evidence

The later diagnostics receipt is distinct from the historical 23/23 dirty-snapshot handoff. On cached offline Node `22.23.2`, an isolated `HEAD` `87ecd7836a47751794f66e814d42f4b52e9aa120` snapshot plus only the five diagnostics overlays measured **304 additions / 1 deletion** and passed `node --import tsx --test test/wp00/plugin-diagnostics.test.ts` (**6/6**) plus `tsc --noEmit` (both exit `0`). The exact verified bytes were later locally committed as `ee9e7d257126c2e7dc6498bb171d952597ba6b56`; they were not rerun. Evidence, exact patch, hashes, post-commit proof, and pre/post unchanged manifests are retained in [`delivery-slice-plugin-diagnostics.md`](delivery-slice-plugin-diagnostics.md). This tests the default accessor/legacy summary and direct aggregation only; populated runtime accessor behavior and functional MCP tool-name runtime behavior were not proven. No HTTP/npm/scanner/auth claim follows.

## Gateway deleted-cwd correction evidence

Delivery-slice inventory: [`delivery-slice-gateway-cwd.md`](delivery-slice-gateway-cwd.md). Local commit `87ecd78` does not imply publication, remote merge, fresh review PASS, or WP00 closure.

The locally committed correction is limited to source hash `298d79ec2cc045f1e292d937d88308a562da2912e2f737956facfb9a784a219c` in `87ecd78`. After the earlier docs-only preparation, a fresh verifier used an isolated Node 22.23.2 snapshot of `HEAD` plus only the three candidate overlays, with cached dependencies matching the lock. It ran `node --import tsx --test test/wp00/log-setup-merge.test.ts` (**24/24**, including removed cwd), `node --import tsx --test test/setup/gateway-setup.test.ts` (**27/27**), and `tsc --noEmit` (exit 0). The retained proof remains valid without a rerun because post-commit proof verified the exact candidate hashes unchanged. Exact logs, gate exits, hashes, and unchanged repository manifests are retained in [`delivery-slice-gateway-cwd.md`](delivery-slice-gateway-cwd.md). The 51/51 setup cases are disjoint within this verification and are not added to the preceding 23/23 snapshot or any historical total. No build, network, provider, real CLI, or real HOME was used.

The regression first observed `escaped:true` after removing only a new empty private cwd; after the correction it observes return `1`, `escaped:false`, and `[setup-gateway] Unable to update Claude Code settings.`. The existing 17 stdout entries and helper identity are preserved. Host Node 25's full merge fixture instead returned empty child stdout; that harness cause remains unresolved and is not claimed fixed. The isolated Node 22 evidence above is separate proof, with no lingering process, temp-directory, or `.llm-gateway` side effects.

### Claude deleted-cwd negative probe

One separate isolated Node 22.23.2 probe invoked `node --import tsx test/wp00/fixtures/log-setup-merge-child.ts <synthetic-home> <marker> claude removed-cwd` with a synthetic HOME and the fixture's stubbed `claude` CLI. It returned `code:0` and `escaped:false`; the gateway deleted-cwd case was therefore not reproduced for Claude setup. This probe used the fixture's `configPathOverride` target, not the real `homedir()` fallback, and does not close other Claude pre-merge path, output, CLI, filesystem, or atomicity boundaries. It is a negative boundary result only and is not added to any preceding verification total.

### Real OpenCode FREE adapter smoke (2026-09-09)

One bounded real-provider smoke crossed `CliOpenCodeAdapter.generate()` using the actual source adapter, `execCliSync`, and the real OpenCode CLI. The parent and child ran from the owned empty directory `/tmp/bridge-adapter-preflight.jog4rO/empty-cwd` with synthetic HOME/XDG directories, an `env -i` environment, a Vault stub whose `getFile()` returned `undefined`, deny-all permissions, empty plugin/MCP/instructions/agent configuration, and documented default-plugin, autoupdate, LSP-download and Claude-context disables. The generic prompt was `Reply exactly BRIDGE_OPENCODE_FREE_OK. Do not use tools.`; no source or project context was sent to the model.

- Source identity: HEAD `922e7fd039556f7ed724ce39a20fb693d14c702a`; `src/adapters/cli-opencode.ts` SHA-256 `a2c8da734c1a6421294091513f9ed65d6a49163a1c282766432d8b020e98d78b`; `src/adapters/cli-utils.ts` SHA-256 `96c4646caa93d2b4a519a85a11cc32734ff7ff210a5f8c80062f19ffae1bdf82`.
- Both the primary `model` and auxiliary `small_model` were pinned to `opencode/mimo-v2.5-free`; the OpenCode log shows the title helper and primary generation using that same model.
- The adapter returned exact text `BRIDGE_OPENCODE_FREE_OK`, `provider`/`resolvedProvider` `opencode-cli`, `model`/`resolvedModel` `opencode/mimo-v2.5-free`, `fallbackUsed:false`, `tokensUsed:2025`, and `stop_reason`/`finish_reason` `stop`. Response evidence SHA-256: `d99f79f87bfd2d27c6417f1d2bf65aee09db9e0ca9e46ad92a9ac3678b9dcc6f`.
- The model catalog and official pricing documentation identify this model as FREE. No final billing amount is asserted here: the earlier `cost=0` session-creation log predates inference, while the adapter response does not expose provider billing.
- The initial restricted Node-to-Node marker failure is distinct from the target path: a later real `execCliSync('opencode',['--version'])` probe captured OpenCode `1.18.29` successfully under approved network execution. This is adapter-boundary evidence, not a fixed Node bug.

This result is adapter-only evidence; it does not verify the router, HTTP/MCP server, full roadmap, or WP00 closure. No build or commit was performed, and this scoped smoke is not added to any test total.

### Real OpenCode FREE HTTP adapter smoke (2026-09-09)

One in-process Hono `app.request('/v1/generate')` call traversed the production HTTP handler, Router/planner/executor, `CliOpenCodeAdapter`, `execCliSync`, and the real OpenCode provider. The request explicitly selected `provider: "opencode-cli"` and `model: "opencode/mimo-v2.5-free"`; with only that provider registered and no `freeModelRouter`, `routing.attemptedProviders` contained only `opencode-cli` and `fallbackUsed` was `false`. Both the primary `model` and auxiliary `small_model` were pinned to the same FREE model.

The response was HTTP 200 with exact text `BRIDGE_HTTP_OPENCODE_FREE_OK`, `provider`/`resolvedProvider` `opencode-cli`, `model`/`resolvedModel` `opencode/mimo-v2.5-free`, `tokensUsed:2004`, and `stop_reason`/`finish_reason` `stop`. Response evidence SHA-256: `1b2e45e25f4fdba1284a0015edc9ccf83972888a0ce10f301c73f1ecf3ef4d93`.

Isolation matched the prior adapter smoke: an owned empty CWD, synthetic HOME/XDG, `env -i`, no credentials, deny-all tools, and empty plugin/MCP/instructions/agent configuration. The Vault stub returned `undefined`; `costTracker` and `requestLogger` were omitted. This proof excludes the full app, authentication middleware, TCP listener, MCP server, and full roadmap closure. Final provider billing was not measured, and this scoped result is not added to any test total. No build or commit was performed.

### Real OpenCode FREE full-factory authentication preflight (2026-09-09)

Using the existing isolated Node 22.23.2 container, a private byte-identical snapshot exercised the real `createHttpApp` factory, SQLite-backed `Vault`, `createApiKey`, multi-tenant `apiKeyAuth`, Router, and sole `opencode-cli` registration without provider inference. The three bounded cases returned `401 MISSING_AUTH` (no credentials), `401 INVALID_KEY` (invalid synthetic key), and `400 VALIDATION_ERROR` (valid synthetic key with an intentionally invalid body). A delegating `Router.generate` counter remained `0`; this proves the auth/factory/validation boundary only, not authorized generation.

- Source identity remained HEAD `922e7fd039556f7ed724ce39a20fb693d14c702a`; `src/server/http-app.ts` SHA-256 `c70fb0bd2eba9f64790c199499f99e64a420c7fcff6b93952599dd5e660b9466`.
- Result evidence: `/work/.full-http-auth.6F2h8p/auth-result.json`, SHA-256 `175f49724a1e3ef8d034095cd8b6a7a997479e71a918adda7d7daec1d1b78284`. The snapshot contained no `.env` or `.git`; synthetic credentials were not recorded in the audit.
- The host Node 25 native-binding failure for `better-sqlite3` was bypassed only by this pre-existing disconnected Node 22 runtime; no production runtime was changed. No live authenticated generation, TCP listener, MCP server, or full production bootstrap was exercised.

No build, install, network change, or commit was performed. The earlier cleanup attempt was rejected by tool policy; after explicit user consent, the exact regular file `/tmp/full-http-auth-runtime.db` was removed from the verified container (no WAL/SHM sidecars were present). The result and snapshot evidence remain preserved, but this proof does not claim complete resource cleanup for all retained snapshot files and is not added to any test total.

### Real OpenCode FREE authenticated full-factory smoke (2026-09-09)

A new isolated container exercised the real `createHttpApp` factory, in-memory SQLite `Vault`, `createApiKey`, multi-tenant `apiKeyAuth`, Router, `CliOpenCodeAdapter`, and OpenCode provider. The offline unauthenticated preflight returned `401 MISSING_AUTH` with zero `Router.generate` calls. Exactly one authenticated in-process `app.request('/v1/generate')` then returned HTTP 200 with exact text `BRIDGE_AUTH_OPENCODE_FREE_OK`, `provider`/`resolvedProvider` `opencode-cli`, `model`/`resolvedModel` `opencode/mimo-v2.5-free`, `fallbackUsed:false`, `attemptedProviders:["opencode-cli"]`, `stop_reason`/`finish_reason` `stop`, and `tokensUsed:158`.

- Main and auxiliary `small_model` were both pinned to `opencode/mimo-v2.5-free`; only `opencode-cli` was registered and no `freeModelRouter` was present. Response evidence SHA-256: `a23d77f072e28bcd575ae5848013238728b41ef99c5cb39c137e9588c090f7f1`.
- Source identity remained `src/server/http-app.ts` SHA-256 `c70fb0bd2eba9f64790c199499f99e64a420c7fcff6b93952599dd5e660b9466`. Final OpenCode session metadata was read from the retained container's `/tmp/full-http-auth-run/data/opencode/opencode.db` (`cost:0`, input `104`, output `54`, cache read `1792`); this is observed provider metadata, not a billing guarantee.
- The owned container `e993718cd6f96f438350d0f0657d9d0bda0fe6fc28695b5225d3e7a261481419` was stopped after the call with no mounts or ports. The original disconnected container remained unchanged. The in-process factory proof excludes a TCP listener, full production bootstrap, MCP server, and roadmap closure; it is not added to test totals. The approximately 186.4 MB source-plus-OpenCode payload (plus cached dependencies) remains retained in the stopped container; no total disk size or deletion is claimed. No code fix, build, or commit was performed.

## Delivered components versus unit closure

| Area | Source evidence | Supported conclusion |
|---|---|---|
| SAFE-CORE | `a0da0fa`; safe-error, operation and telemetry primitives | Historical implementation and focused evidence exist; not newly re-audited here. |
| SCAN-BIN | `507ef2e`; deterministic codecs and bounded JSON | Historical component evidence exists; not a complete repository scan. |
| AUTH-RUNTIME | `a361e73`; auth runtime/config and focused tests | Historical runtime/config foundation; not completed OAuth, HTTP binding or CSRF. |
| ERR-EXECUTION / ERR-HTTP-FOUNDATION | `02e5a17`, `60278d9` | Historical containment components; remaining route projections still need their own work. |
| ERR-MCP-DYNAMIC / ERR-MCP-SERVER / LOG-CORE | `afe47ec`, `a941749`, `089c984` | Historical scoped implementations; not all MCP, security-wrapper or logging closure. |
| Storage POST/GET | `ef6f2f5`; `test/wp00/err-http-storage.test.ts` | Four real routes return constant internal errors without exception getters or coercion. |
| Storage DELETE | `0457b17`; `test/wp00/err-http-storage-delete.test.ts` | Genuine Vault errors preserve 403/404; unknown failures return constant 500 without inspecting hostile values. |
| Execution HTTP | `1b47695`, `dd94f74`, `2a456e1` | Non-streaming failures, both public SSE protocols and Anthropic preparation use constant errors; genuine validation statuses and streaming lifecycle remain tested. |
| Observability HTTP | `1cb858b` | Local finite validation fields and constant downstream errors; successful data, 503 behavior and the fixed week-dimension message remain compatible. |
| Admin keys/profiles | `d9cab8d` | Six route catches, local validation and structured 404 responses contained; intentional key creation plaintext and revocation behavior retained. |
| Admin operations | `d422a487`; `test/wp00/err-http-admin-operations.test.ts` | Two constant 500 catches and fixed missing-provider 404; breaker reset, flush and NOT_CONFIGURED behavior retained. |
| Admin discovery | `51a010ef`; `test/wp00/err-http-admin-discovery.test.ts` | Exceptions and embedded diagnostics contained without changing discovery cardinality, backend status or intended success metadata. |
| Sync GET readback | `a10ee2d`; `test/wp00/err-http-admin-sync-readback.test.ts` | Four GET failures, validation and historical diagnostics projected without rewriting persisted history. |
| Sync POST validation | `8bf9528f`; `test/wp00/err-http-admin-sync-validation.test.ts` | Finite provider validation and canonical credentials instructions; request/environment/Vault precedence and JSON asymmetry preserved. |
| Sync POST actions | `e98c308`; `test/wp00/err-http-admin-sync-actions.test.ts` | Unknown errors use constant 500; genuine conflicts retain 409 through private identity; active-run and price-result diagnostics projected. |
| Approvals HTTP | `4d953903` | Three constant 500 catches; fixed 404, decisions, resolvedBy and intended successful payloads retained. |
| Admin shell characterization | `cbf2b70`; `test/admin.test.ts` | Nondefault profile and signed-JWT extra-claim exclusion tested; no production change or general authentication proof. |
| Usage HTTP | `d38cec3b` | Two constant 500 catches; filters, project precedence, successful payloads and unconfigured 404 retained. |
| Metadata GET | `b91f0a4` | Three read failures contained; OpenAI model envelope, provider/latency payloads, staleness and disabled 503 retained. |
| Cost HTTP | `7884ed1b` | Constant unknown failures and finite validation details; unknown-model 400 and default pricing calculations retained. |
| Local models HTTP | `fa48fb90` | Exception and backend diagnostics contained; full model/backend metadata, readiness, URLs, order and counters retained. |
| Tooling HTTP | `1fd5d262` | Catalog/search/strategies catches contained; query parsing, result projections and lazy default dependencies retained. |
| Circuit-breaker HTTP | `7fe63bc0` | Three constant 500 catches; validation 400, legacy/V2 configuration mapping, updates and statistics preserved. |
| Groups HTTP | `f64b9cef` | Four constant catches, finite validation and fixed missing-resource responses; real CRUD effects and intended weights retained. |
| Comparison history | `eee7c8b4` | History diagnostics projected without rewriting persisted records; metadata, null cost and pagination retained. |
| Comparison actions | `694a842b` | Constructor-captured budget identity preserves genuine 422 numbers; unknown failures and successful-envelope diagnostics contained. |
| Comparison validation | `8249c3fc` | Local safeParse returns finite first fields and constant 400; schema, defaults, bounds and downstream error classification retained. |
| MCP security | `1745d565` | Fixed denial/rate text; real SDK transport verifies filtering, quota and delegation. No universal delegate-exception containment. |
| HTTP security characterization | `37fbd076` | Test-only evidence for existing fixed 403, configured profile, method/query distinctions and delegation; no authentication redesign. |
| ACP server errors | `f23bed01` | Private protocol-error identity and fixed task diagnostics; reachable numeric codes and lifecycle tested, not external framing coverage. |
| Plugin messages (partial) | `8c4030ed` | Four fixed issue messages and private per-import timeout identity; the worker-owned true import-cancellation scope is archived separately. Scanner-issued diagnostic identity and provenance binding remain unresolved. Enumeration corrections are recorded separately below. |
| Security operational warnings | `de8c39b`; `test/wp00/log-security.test.ts` | Three warnings use finite metadata without tool/path reflection; authorization, quotas and HTTP delegation preserved. |
| Model autosync logging | `8a16ac4`; `test/wp00/log-model-sync.test.ts` | Unknown callback errors become fixed events; genuine overlap silence and scheduling retained. Internal history is unchanged. |
| Migration logging | `3b030a7`; `test/wp00/log-db-migrations.test.ts` | Five fixed events retain only valid numeric versions; SQLite transaction, order, reconciliation and rollback controls preserved. |
| OAuth sync logging | `d6f8bfc2`; `test/wp00/log-claude-oauth.test.ts` | One catch contains diagnostics; isolated synthetic HOME verifies compatibility without accessing real credentials. No storage-permission or atomicity improvement claimed. |
| Price autosync logging | `15fae347`; `test/wp00/log-price-sync.test.ts` | Fixed failure event and private conflict identity; genuine overlap, scheduling and stop behavior preserved. |
| Vault refresh fallback | `604a06b9`; `test/wp00/log-vault-refresh.test.ts` | Fixed warning preserves fallback token and sync; guarded synthetic HOME and internal-fault injection, not remote refresh implementation. |
| Claude setup diagnostics | `877537ac`; `test/wp00/log-setup-claude.test.ts` | Two fixed Console catch messages; CLI stub, exit codes, fallback merge and backups tested without real CLI execution. |
| Gateway setup diagnostics | `2f6dc49`; `test/wp00/log-setup-gateway.test.ts` | Two fixed Console catch messages; synthetic env/settings preserve intentional token output, parsing and merge behavior. |
| Vault audit normalization | `eb57de62`; `test/wp00/log-vault-audit.test.ts` | Four catch normalizers preserve original error identity without inspection; 29 new cases prove failure audits, existing Pino redaction and CRUD compatibility. |
| Setup merge failures | `e9453315`; `test/wp00/log-setup-merge.test.ts` | Both orchestrators return 1 with fixed Console errors for merge failures; low-level helpers retain original throws and partial filesystem effects. |
| Plugin enumeration boundary | `9b987767`; `test/wp00/err-plugin-enumeration.test.ts` | Missing-directory recovery surrounds only readdir; subsequent processing/cleanup failures propagate without false empty success. |
| Plugin enumeration shapes | `8db102a0`; `test/wp00/err-plugin-enumeration.test.ts` | Native-error guard plus own data descriptor restrict ENOENT recovery; matrix proves original rejections and zero observable traps, not filesystem provenance. |
| Contract regression debt | `6c9d998` | Eleven stale durable-payload/raw-error expectations reconciled; consumer payload/error identity and routing/retry/abort assertions retained. |
| Root API/inventory | `6c4db2e`, `91bb703` | Implemented identity validation and inventory collection; not aggregate admission. |
| Root format components | `05a01b3`, `40c1382`, `4a27cd2`, `be0361d`, `1744307`, `b803363` | Package/shell/Actions/Docker/Compose and bounded PNPM support have component tests. |
| Root integration/reporting | `2ddd3a5`, `87b1f01`, `d47e766` | Classification, existing-snapshot comparison and operational coverage reports are available. |
| AST components/reporting | `f712bdc`, `4e3cebf`, `ad28eec`, `29f7cd0`, `d118294`, `6078724`, `5d3f9a1` | Syntax, bounded bindings, selected direct calls, callbacks and conditional evidence exist; SCAN-AST remains partial. |

Storage and observability are verified slices of `ERR-HTTP-API-B`, not completion of its entire ledger.
The ledger assigns api-keys to `ERR-HTTP-ADMIN-A` but security-profiles to `ERR-HTTP-ADMIN-B`.
Admin-A keys, discovery and operations now have verified production slices; this is not canonical unit closure.
Admin-B also owns administrative shell and approvals; their new scoped evidence does not establish canonical Admin-B closure.
Its historical ownership spans profiles 342–352, shell 353–355, sync 356–386 and approvals 387–394.
Approvals catches are now contained; shell characterization preserves intended identity/profile fields without inventing a raw-error defect.
API-A also owns comparison and groups; API-B also owns circuit-breaker, metadata, tooling and usage.
Metadata, tooling, usage, circuit-breaker, groups and comparison now have verified containment slices, not canonical API-A/API-B closure.
Comparison projects service-produced diagnostics in both successful POST and history envelopes while preserving intended responses.
Its fixed COST_EXCEEDED 422 message was an explicit delivery decision, distinct from the BUDGET_EXCEEDED 403 contract.
The security-profile HTTP middleware's existing fixed 403 now has characterization evidence; broader security closure remains unverified.
Plugin import proxy coverage compares the loader against native .mjs behavior; it proves no additional loader inspection, not zero engine inspection.
Enumeration coverage is separate: native-error recognition precedes an own DATA descriptor check with strict ENOENT comparison, without reading an error accessor.
Constructed native Errors with own ENOENT, including cross-realm errors, remain accepted by shape. This is not filesystem provenance, scanner authority or ERR-PLUGIN closure.
Execution fixes do not certify every API-A projection or upstream exception normalization.
No handler-level regression suite establishes authentication, CSRF or whole-product safety.
Vault's four unknown-error audit normalizers now use a canonical message; original rethrows and audit identity fields remain unchanged.
Pino already redacts the error field: the latest correction proves zero inspection and original-error preservation, not a newly discovered serialized-message leak.
Typed deletion diagnostics and freeform audit identity metadata remain separate compatibility scopes.
Component commits do not automatically satisfy every scenario attached to a canonical row.

## Mandatory closure work still outstanding

The archived `plugin-runtime-cancellation` change is not an outstanding task and is not renewed by this report. Remaining plugin work concerns the separate scanner-issued identity/provenance contract and other canonical rows; the archive's worker scope does not satisfy those requirements by itself.

### Production behavior

- Finish all ledger-assigned HTTP, MCP, ACP, plugin and security error surfaces.
- Preserve protocol status codes and response envelopes rather than collapsing operational failures into generic statuses.
- Complete the planned auth binding, OAuth, CSRF, administrator and UI behavior with their specified evidence.
- Complete health/provider-registry and cost/circuit/model evidence semantics; missing evidence must not look healthy.
- Close remaining logging, telemetry persistence/readback, UI projections and compatibility requirements.

This reconciliation does not assign an implementation-complete count to these remaining groups.
Existing product implementations may be present; their required WP00 deltas and closure proofs remain unverified here.

### SCAN-ROOT integration

- Complete required registry grammar coverage without relabeling required constructs as optional or unsupported.
- Resolve generated-root provenance and devcontainer execution semantics.
- Integrate independently admitted image/build configurations rather than infer trust from tags or self-computed hashes.
- Assemble the manifest with complete dispatch and prove zero unparsed or unresolved execution roots.
- Preserve authoritative path, mode, length, hash and inventory agreement across passive and execution records.

The earlier storage snapshot recorded the planned `.devcontainer` directory as absent; that filesystem fact was not refreshed here.
Coverage CLI success means a report was produced, not that its roots were admitted or safe.
The existing-snapshot dispatcher is not a first-run authority bootstrap.

### SCAN-AST closure

- Bind current production declarations through independently trusted selection, not historical names or self-hashes.
- Complete the required resolution, controlled-flow and suppression behavior across the actual inventory.
- Address current program/resource limits and the oversized generated bundle without silently omitting files.
- Keep unresolved calls, wrappers, factories, spreads and flows visible until the required gate can close.

Lexical argument references do not prove value origin.
Identity-return summaries are conditional on executing the selected declaration's body; they do not prove runtime call binding.
Neither evidence type establishes safety, admission or whole-program flow closure.

### Hermetic execution, delivery artifacts and final integration

- Complete HERM-RUNNER, loopback/child boundaries, filesystem units and the evidence image.
- Produce the required root-suite evidence through the specified CI integration, with reliable lifecycle/cleanup.
- Finish publication/build provenance, old/generated artifact handling and distribution claims.
- Verify dashboard generation, both CI surfaces, compatibility, claims and final integration.

The historical handoff contains old staging snapshots and native-block records.
Those records remain historical evidence, not a description of today's index or a new DIRECT completion decision.

## Plugin identity integration: observed boundary and prerequisites

The archived worker scope does not remove every identity requirement. Internal runtime registry admission (filename-derived identities and collision handling) is a routing/compatibility concern; it is not a scanner-issued diagnostic ID and it is not supply-chain authorization. The canonical WP00 contract requires scanner-issued diagnostic IDs at the diagnostic boundary. No new signed-authorization system, signer, or trust root is proposed here.

| Observed source | Current behavior | Missing integration prerequisite |
|---|---|---|
| `src/mcp-builder/loader.ts:PluginLoadIssue,loadPlugins` | Accepts a plugin directory and runtime options; issues contain filename-derived plugin/file and optional raw toolName. | An independently admitted mapping from exact candidate identities to scanner-issued diagnostic IDs; local filenames are not that issuer. |
| `src/server/mcp-server.ts:startMcpServer,getDynamicPluginLoadSummary` | Keeps the detailed legacy summary, including directory, loaded names/toolNames and collisions; `getDynamicPluginDiagnostics()` now projects only enabled/loaded/allowlisted code counts. | Preserve the legacy compatibility view while binding any future diagnostic IDs to the scanner-issued contract; the new projection is not authorization. |
| `src/mcp-builder/plugin-runtime-registry.ts` | Admits runtime entries and detects filename/collision conflicts for local routing. | Do not relabel registry admission or collision keys as scanner diagnostics or supply-chain authorization. |
| `src/server/mcp.ts` | Re-exports the summary accessor; the bounded source search found no other production caller. | Consumer verification must include external callers; absence of another internal caller does not make the export private. |
| `test/contracts/scanner/root-batch-dispatch.mjs:createRootBatchDispatcher` | Requires an independently admitted existing snapshot; checks inventory and hashes and dispatches roots. | This local verification seam is neither a first-run issuer nor a plugin/tool ID registry. |
| `src/server/mcp-server.ts:dynamicPluginOperationEvent` | Logging projection already reports counts rather than raw loader issue contents. | Preserve this existing containment; do not infer that all plugin summary consumers are equally contained. |

No production scanner-issued plugin/tool diagnostic-ID input was found in these inspected interfaces.
The required issuer/binding must cover path, mode, bytes/hash, candidate scope and stable tool association before import.
External plugin directories and dynamically produced tool definitions cannot be assumed covered by a repository snapshot.
Missing, stale, duplicate or ambiguous bindings need an explicitly approved fail-closed behavior and tests before wiring.
Filename hashes, local counters, historical test catalog entries or caller-created self-hashes do not supply that authority.
The additive diagnostics projection is therefore a safe privacy boundary, not evidence that scanner identity integration or supply-chain authorization exists.
The current scanner's resource, grammar and admission gaps above remain unchanged.
A complete identity integration is not honestly scoped as one ready sub-400-line change from the evidence available here.

## LOG-OPERATIONS: bounded current-source reconciliation

All nine source paths assigned by the historical ledger were inspected for current producers; this is not a repository-wide log scan or current scanner admission.
The table separates emitted logs from state/storage projections that the historical ownership also includes.

| Assigned source | Current classification | Evidence limit / remaining work |
|---|---|---|
| `src/db/migrate.ts` | Five fixed version-only Pino events delivered. | Focused SQLite evidence exists; no schema or error-classification redesign. |
| `src/model-sync/sync-manager.ts` | Autosync catch delivered; summaries, lastError and SQL history still retain diagnostic strings. | HTTP projection does not sanitize internal persistence; remaining nonlogging records require separate treatment. |
| `src/price-sync/price-manager.ts` | Autosync catch delivered with fixed event and private conflict identity. | Diagnostic state/history remain separate nonlogging projections; no persistence sanitization claim. |
| `src/security/enforcer.ts` | Three warning projections delivered; constructor logs configured profile/categories/rate limits and finite mode. | Constructor is not a raw exception sink; arbitrary runtime mutation and complete unit coverage are not certified. |
| `src/server/admin.ts` | Historical adminAuth sites currently return fixed HTTP responses, not logs. | No logging defect inferred; authentication redesign remains separately pending. |
| `src/setup/claude-code-setup.ts` | Scope/registration diagnostics and orchestrator merge failures have fixed Console messages. | Pre-merge path/output failures are not globally contained; low-level throws, path instructions and partial writes remain. No real CLI integration or atomicity claim. |
| `src/setup/gateway-setup.ts` | Scope/port diagnostics and orchestrator merge failures have fixed Console messages; the deleted-cwd settings-path correction is locally committed in `87ecd78` and freshly functionally verified. | Intentional token exports, JSON settings, and other pre-merge path/output failures remain unverified; no rollback or global exception-containment claim. |
| `src/vault/claude-oauth.ts` | Sync failure catch delivered; refresh warning is already a fixed instruction. | Do not fabricate a refresh-message defect. Credential storage and actual refresh implementation remain outside this delivery. |
| `src/vault/vault.ts` | Refresh fallback warning and four unknown-error audit normalizers delivered. | Audit provider/keyName/fileName/project remain freeform and unchanged; typed deletion messages remain distinct. Intended file-content returns are not blanket-redaction targets. |

No all-contained conclusion follows: intentional setup output, audit identity metadata, outer failures and diagnostic persistence remain distinct boundaries.
Delivered catches must not be listed as pending defects; remaining behavior needs a bounded contract/evidence decision before another implementation.
These deliveries do not close LOG-OPERATIONS or establish its LOG-SERVICES predecessor.

## SCAN-ROOT-API scoped evidence (2026-09-10)

`SCAN-ROOT-API` is **scoped verified**, not canonically admitted. The retained original proof remains byte-for-byte available at `/tmp/scan-root-api-proof-v23rixjq/artifacts/proof.json` (SHA-256 `b102ccec98d2e0207b42c08945957f98fda1966ca3970c089bdac0bdb66cb417`). Its terminal metadata still said `prepared-not-executed` despite two retained exit-0 execution records. The metadata-only correction is [`final-proof.json`](/tmp/scan-root-api-proof-v23rixjq/artifacts/final-proof.json) (SHA-256 `97a18758aa186be2c9555d3d0ae0d3f0384ada3f06b08474794351a3a82a5360`); it records `executed-passed`, preserves the original proof bytes, and did not rerun a gate or change source.

| Evidence item | Retained identity / result |
|---|---|
| Focused contract gate | `node --import tsx --test test/wp00/scan-root-api.test.ts`, Node `v22.23.2`, exit `0`, **5/5**. [Log](/tmp/scan-root-api-proof-v23rixjq/artifacts/scan-root-api.log): `8152ee661d7f94ce68b98a354da7237dc2023537c523585c59cf00682b42edaa`. |
| Typecheck gate | `/work/node_modules/.bin/tsc --noEmit -p tsconfig.json`, exit `0`, no diagnostics. [Log](/tmp/scan-root-api-proof-v23rixjq/artifacts/tsc-no-emit.log): `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |
| Candidate/source identity | `test/contracts/scanner/root-api.mjs` `32c20deb0ba3a596acf1d682ff8108a58f1e7639fa9497fe703f3a84fe8ce572`; `test/contracts/outward-scanner.mjs` `b2b54f5e84fccef0de38da09aa976f6d53bb298b0dddfe3b22f1b8f60a5f538c`; `test/wp00/scan-root-api.test.ts` `a4d1ec389b006ebf1da8d6462a87a48559dad6282bb7dc9553f2932195b81e8f`. Each matched HEAD, current workspace, and scratch; neither candidate patch touched them. |
| Contract mapping | `SCAN-ROOT-01`: captured registry and deterministic canonical parsed result (`root-api.mjs:45-58,61-68,93-100`; test `:24-38`). `SCAN-ROOT-02`: sanitized, stable-sorted rejection with no partial edges (`root-api.mjs:45-58,95-100`; test `:39-54`). |
| Scratch preflight | The first `git archive` scratch had no byte mismatch but one fixture-mode mismatch (`plugin-runtime-acceptance.json`, archive `0664`, current `0644`). A fresh owned scratch copied that one current mode; all 29 candidate bytes/modes matched before either gate. |

The focused test uses in-memory buffers, fake parser authority, and the library import closure. It does **not** execute SCAN-BIN cryptographic/provider admission, outward-scanner CLI/batch dispatch, providers, network, subprocesses, database, application/runtime initialization, package qualification, or aggregate `SCAN-ROOT` closure. The scoped proof therefore preserves the verified API while leaving authority admission independent.

<!-- evidence:begin -->
- [executed] The focused SCAN-ROOT-API contract suite passed. cmd=`node --import tsx --test test/wp00/scan-root-api.test.ts` exit=0 cwd=`/work/.scan-root-api-proof-v23rixjq`
- [executed] The isolated candidate no-emit typecheck passed. cmd=`/work/node_modules/.bin/tsc --noEmit -p tsconfig.json` exit=0 cwd=`/work/.scan-root-api-proof-v23rixjq`
- [read] The focused API guard and its authority boundary are defined in the root contract. src=test/contracts/scanner/root-api.mjs:61-106
- [read] The five focused cases include SCAN-ROOT-01 and SCAN-ROOT-02. src=test/wp00/scan-root-api.test.ts:23-85
<!-- evidence:end -->

## AUTH-BIND-CORS requirements-based scoped verification (2026-09-10)

`AUTH-BIND-CORS` is **scoped verified for defined bind/CORS behavior**, not canonically admitted. The durable [acceptance map](auth-bind-cors-acceptance.md) distinguishes normative requirements from extra implementation coverage, records exact assertions and retained evidence, and documents why aggregate `HTTP-BIND-01..06` / `CORS-01..10` labels are not a 16/16 result. It does not change the historical 68-unit checklist, delivery status, or WP00 closure state.

| Current executed receipt | Scope |
|---|---|
| Candidate | 39 source paths: runtime 29 + AUTH-BIND-CORS implementation 9 + test 1; manifest `c4d630d9b2d1883828dadd982e2de5063811732ecae0a6a87f4bff605c152dbf`. Only `test/wp00/auth-bind-cors-production.test.ts` is new; no production source/configuration changed. |
| Commands | The retained proof records the new test 2/2, combined 21/21 across five suites, and canonical `tsc --noEmit`, all exit 0 with exact command/cwd/log hashes: [proof](/tmp/auth-bind-cors-production-wiring-final-20260910/artifacts/proof.json), SHA-256 `c55b46c67fc563070b4248317c1ac38eec7cefc0be8dc7b0442fb57236929bfc`. Local `/tmp` locators are nonportable. |
| Defined result | REQ-HTTP-01 default/private and explicit remote/static-auth configuration behavior is exercised through the listener helper fake; CORS exact methods/headers/credentials plus valid 204 and invalid/missing 403 preflight behavior are exercised through helpers and actual `createHttpApp(...).request()`. Missing auth is **401**, not “authenticated 401.” |
| Limits | Real `startHttpServerWithDeps`/`serve` and a port are unexecuted optional integration work. Static SQLite import did not open DB; health/OAuth/admin exceptions and AUTH-ADMIN remain separately owned. No separate functional test-contract conclusion is recorded here. |

The preceding 18- and 19-case receipts remain historical scoped evidence. Trusted-proxy and lexical-origin coverage are extra implementation hardening, not an expanded normative claim. No production seam is needed solely to increase coverage.


## ERR-ACP raw single-request scoped verification (2026-09-10)

`ERR-ACP` is **scoped verified** for the defined ten ACP numeric code/message fixtures and the approved raw single-request adapter. C2 changes only the test: a shared recording handler now proves zero typed `handleRequest` calls for malformed/every invalid raw input (including `-32602`) and exactly one call for valid input. The durable [acceptance map](err-acp-acceptance.md) records the final 43-source-path candidate, exact 23/23 focused command and canonical `tsc --noEmit` evidence, the retained RED/typecheck history, and explicit boundary exclusions. It is not canonical ACP scenario admission, a full JSON-RPC transport, review PASS, delivery, or WP00 closure.

| Current executed receipt | Scope |
|---|---|
| Candidate | 43 source paths (prior 39 + four ACP source/test paths), manifest `1ebb2b85e1c8fdda972c83733dede6dbffccf38710054c7b11a469dfe16e102c`. C2 is test-only; 42 nonowned source paths matched pre/post, including unchanged production. The combined five-path patch still contains the contract update; its reconstructed contract preimage is not a complete pre-edit foreign-content snapshot. |
| Commands | Final focused suite: 23/23 in two suites, exit 0; canonical `tsc --noEmit`: exit 0. Exact commands, cwd `/work/.acp-raw-json-dispatch-c2-20260910`, logs, and hashes are retained in [C2 proof](/tmp/acp-raw-json-dispatch-final-20260910/artifacts/proof.json), SHA-256 `a86457df1dfa64535bb3138467d257305ea4c8574107309917ea7787d0ac3620`; local `/tmp` locators are nonportable. |
| Defined result | `handleRawRequest(rawJson)` reaches `-32700` parse error with null id and safe-id `-32600` invalid request responses. C2 directly proves zero typed-handler calls for malformed/every invalid raw input, including `-32602`; valid object-named input forwards exactly once to unchanged `handleRequest`. The ten code/message fixtures remain exact. |
| Limits | Batch arrays, notifications, framing, serialization, stdin, ports, sockets, network, database, providers, and runtime bootstrap remain excluded. Duplicate keys retain native `JSON.parse` last-key-wins behavior. A separate functional check is underway; no formal review conclusion is recorded here. |


## ERR-HTTP-ADMIN-A route-containment scoped verification (2026-09-10)

`ERR-HTTP-ADMIN-A` is **scoped verified** for seven owned Admin-A registrations: 13 focused tests cover eight literal-independent injected generic failures and five preserved `NOT_CONFIGURED` branches. C2 changed only the test oracle, removing the production-helper import and asserting the public generic message literally. The durable [acceptance map](err-http-admin-a-acceptance.md) retains the final 45-source-path candidate, command/log hashes, source/test matrix, historical proof limitations, and exclusions. It is not canonical SAFE-HA admission, full authentication/application evidence, review PASS, delivery, or WP00 closure.

| Current executed receipt | Scope |
|---|---|
| Candidate | 45 source paths: prior 43 plus `operations.ts` and the isolated test; final manifest `7f8591a67acf44f48a008232b4ac538e9bea13b2d8de3f8628a801c550bc997d`; current test SHA-256 `90fbda18948b3a32a214b949badc14eaec43452be74253017f1d8b35d089af85`. The original literal proof's manifest filter was blocked (45 prior rows versus 44 current); final proof records a read-only parse/exact-test-exclusion comparison that matched all 44 remaining mode/hash/path entries, SHA-256 `6d2404980faf4a403a34e0c9d3df36fc3a420218dfa35a41bd99a6d6a8cf8a3b`. |
| Commands | Focused isolated suite: 13/13, exit 0; canonical `tsc --noEmit`: exit 0. Exact commands, cwd `/work/.err-http-admin-a-c1-red-20260910`, logs, and hashes are retained in [final proof](/tmp/err-http-admin-a-literal-final-20260910/artifacts/final-proof.json), SHA-256 `f72cfd331ec296898309b8aa82fa68ea46681aed34967f6897b95943d8cf864e`; local `/tmp` locators are nonportable. |
| Defined result | Generic hostile failures return literal-independent exact 500 `INTERNAL_ERROR`, no hostile getter/coercion canary, and no `app.onError` fallback; expected dependencies are called once and irrelevant guards zero times. The three key, catalog, and tracker-missing branches retain their exact `NOT_CONFIGURED` responses. |
| Limits | The only production change is type-only dependency narrowing; route bodies are unchanged. The test instantiates no live DB, CostTracker, router, Vault, provider, detector, network, catalog filesystem, listener, or full app. Profile/sync belongs to W04 Admin-B. No formal review conclusion is recorded here. |

## ERR-HTTP-API-A requirements-based scoped verification (2026-09-10)

`ERR-HTTP-API-A` is **scoped verified** for the defined API error-containment behavior, not canonically admitted. The durable [acceptance map](err-http-api-a-acceptance.md) records nine registrations across four response-envelope families: OpenAI nested, Anthropic envelope, and generate/comparison/groups flat specific envelopes. It does not assign meanings to aggregate `SAFE-HC-01..12` labels or turn the tested 512K prompt boundary into an individual-ID claim.

| Current executed receipt | Scope |
|---|---|
| Candidate | 48 source paths; host/container manifest SHA-256 `a943d03ba7d68f8d69963cfecbd4ec59b65cd612fb774484a23abf58d37fd8a6`. The 45 non-owned paths matched before/after, SHA-256 `7f8591a67acf44f48a008232b4ac538e9bea13b2d8de3f8628a801c550bc997d`. |
| Test-only delta | Only the existing `err-http-api`, `err-http-streaming`, and `err-http-validation` tests changed, replacing helper-derived expected messages with independent `INTERNAL_ERROR` and `INVALID_REQUEST` literals. No production source, configuration, fixture, or API changed. |
| Commands | Seven existing suites passed **198/198** (exit 0); canonical `tsc --noEmit` also exited 0. Exact command/cwd/log hashes are retained in [proof](/tmp/api-a-oracle-final-20260910/artifacts/proof.json), SHA-256 `024e26603dd1d30abb0cc790e069e442bd58b03dbc499e040461cd5267d45a59`; local `/tmp` locators are nonportable. |
| Limits | Comparison-history and groups executed their established SQLite `:memory:` lifecycle only. No persistent/project database, provider, network, listener, bootstrap, or Vault was used. This does not close full auth/runtime, aggregate SAFE-HC, delivery, or WP00. |

## ERR-MCP-SECURITY requirements-based scoped verification (2026-09-10)

`ERR-MCP-SECURITY` is **scoped verified** for the defined `ProfileEnforcer.wrapHandlers` deny/rate and delegation boundary, not canonically admitted. The durable [acceptance map](err-mcp-security-acceptance.md) records literal denial/rate responses, authorization before quota with zero delegation, hostile `retryAfter` non-inspection, tool filtering/dynamic metadata, and successful/default arguments. Aggregate `MCP-SEC-01..06` definitions remain unspecified in this bounded reconciliation.

| Current executed receipt | Scope |
|---|---|
| Candidate | 50 paths: prior 48 plus current enforcer and focused test. Prior 48 rows match the retained candidate after sort-only normalization; all 50 source/test mode/bytes matched scratch before and after the gates. |
| Commands | Existing focused test: **7/7** in one suite, exit 0; canonical `tsc --noEmit`: exit 0. Exact commands, cwd, log hashes, and the final count-metadata correction are retained in [proof](/tmp/mcp-security-focused-20260910/artifacts/proof.json), SHA-256 `be4315033e54feca805746f024f548a084c24f86677df7f554152426058435ed`; local `/tmp` locators are nonportable. |
| Limits | `InMemoryTransport` only; no listener, network, provider, Vault, bootstrap, real environment, or project/persistent/RAM database. Universal delegate-failure containment and `ERR-MCP-SERVER` handler-failure proof remain separate obligations. This is not full security/runtime, aggregate MCP-SEC, delivery, or WP00 closure. |

## HEALTH-REGISTRY startup-guard evidence (2026-09-10)

`HEALTH-REGISTRY` has a **narrowly admitted** C1 aggregate. C1 is the single final startup exact-set candidate: one 69-path, 17/17 focused receipt directly proving only **post-local freeze**, **duplicate**, **required**, and **late register**. The selected 17 named built-in canonical registrations are required after normalization, with optional local registration; this is membership only, not credentials or availability.

The historical 53-path core/post-local receipt remains valid for immutable definitions, atomic required/duplicate validation, provider-array copying, frozen mutation refusal, and post-local composition order. The current startup slice adds first-operation `assertProviderRegistryFrozen` guards to HTTP and MCP startup, a real-Router fixture helper, and 15 migrated HTTP/MCP fixtures. Negative tests prove unfrozen routers fail before other dependency reads; positive tests prove frozen routers reach a guarded dependency sentinel rather than a live listener. The final independent literal normalized-17 membership oracle strengthens the fixture without deriving its expected set from production.

Final focused evidence: 17/17 tests across four suites and `tsc --noEmit` exit 0. [Final proof](/tmp/health-registry-startup-exact-set-final-20260910/artifacts/proof.json) SHA-256 `6ffa38f609c8b7bde13bceb6a20e653f536d28b7fff196025f9565db278d90de`; one-file oracle correction SHA-256 `6918fb86a36e363196460c847dd45d638d325bd39444e12dfd264cfdb597e18a`, layered on the 19-path true-preimage patch SHA-256 `d0cc917e320c60ed97ebd3c03ddebeb3da3a52044347c0c5ef286135caf995b8` (`+230/-47`) and prior startup proof `2889e33a…`. The 69-path candidate has mode/byte identity; the correction retained 68 prior rows unchanged.

The earlier two-fixture receipt remains distinct: user consent covered only `test/http-comparison.test.ts` plus `test/http-three-part-prompt.test.ts`, which passed 18/18 in five suites under isolated temporary SQLite/TestVault and loopback HTTP (proof SHA-256 `bb4325746f2a91153769291a0bd211218b6a0b41243ac76561110a6a12a56cf6`; log SHA-256 `3d7ebdbd6f8aa50a8d570b43e4f7a5b8b3732f9bfb8f874d4826e7671dadb26b`). A later separate consent covered exactly `http-cost`, `http-analytics`, `http-metrics`, and `plugin-runtime-lifecycle`: the sequential isolated command passed 49/49 tests in 16 suites, no skips, exit 0 ([proof](/tmp/health-registry-four-fixture-final-20260910/artifacts/proof.json) SHA-256 `5915114d79ea2441b03b4d0520313f05fd18e8576067c2844f697ce4e98ce62b`; log SHA-256 `55e49e75dbd58ad9aa0c6a2da78e2e990bd522b44354908d34aa04f0eeac5690`). A final separate StubAdapter fixture-only receipt changed four existing tests only, preserving the real Router/freeze lifecycle and assertions: `http-middleware`, `http`, `http-logs`, and `admin` passed 109/110 tests in 50 suites with 0 failures, one pre-existing skip (`http.test.ts:518` CORS `OPTIONS`), and `tsc --noEmit` exit 0 ([proof](/tmp/health-registry-stub-adapters-final-20260910/artifacts/proof.json) SHA-256 `bb6c9784352b5ab83a2a5844caec31908148114f16356f9e218d7f44c946846d`; patch `e0a1debd767e11c9c743c358df2cf0f29ea02752eba838a375349aac677e5f0a`; manifest `0b054fdbc3c1cdd67a9349940484b3fc88d766c04dca49af7089cfbd607a34b2`; log `ab1ef0d11d007ac94aee7e17c89733e4c0eef0c7895fa0f0dcc15d0471c89f26`). Its initial host-redirection error happened before Docker/test launch and is historical harness evidence, not a product test failure. The corrected Python argv runner retained 65 other path bytes/modes and cleaned its owned temporary state. Those three historical receipts are distinct. At that point, ten of 15 fixture files had been invoked; `http.test.ts` still had the CORS skip and local-LLM had only read-only classification. The then-remaining discovery seam and MCP-builder lifecycle gaps are superseded as current action by the later CORS/local-LLM receipt below. Neither historical status qualified MCP stdio/full integration, aggregate `HEALTH-REG-01..10`, or WP00 closure.

A later two-file test-only correction resolved the historical CORS skip and qualified the local-LLM fixture's bounded disabled-mode contract. Only `test/http.test.ts` and `test/http-local-llm.test.ts` changed; the final isolated command passed **33/33 tests in 18 suites**, no skips, and canonical `tsc --noEmit` exited 0. It verifies exact allowed/denied CORS preflights and the local safe-error/redaction oracle for two backends while preserving the public disabled `readyReason`. [Final proof](/tmp/http-cors-local-correction-final-20260910/artifacts/final-proof.json) SHA-256 `476b0058f252bd9c2c90c834442d42d15d9daaf557075f4985eee62763a484e1`; final 69-path manifest SHA-256 `0141a25ac2ddbd2011dec59bb35a2598a345a918428e7bfee02fa01cc13d72c8`, with 67 nonowned paths unchanged. The preceding 32/33 receipt and pre-Node launcher syntax history remain historical harness evidence, not product regressions. Eleven of 15 fixture files had then been invoked.

The final discovery-DI receipt invoked three HTTP fixtures: `test/admin-discovery.test.ts`, `test/integration/wiring-sprint.test.ts`, and `test/e2e/full-pipeline.test.ts`. Optional object-style startup DI was forwarded through `http-app.ts` and `admin.ts`, with typed fakes, the real Router/freeze lifecycle, and no global fetch/provider probe. The final run passed **23/23 tests in seven suites**, no skips, and canonical `tsc --noEmit`; proof SHA-256 `cf6a96e21c313eeb2ff158cb33f60cba1b0c1a7b351817ae0b429ae1c58e9831`, log SHA-256 `1126c203e911a9ac42b226f87332d454909267988f70e29ce99892dd339dab0d`. The full runtime materialization was only `src/`, `test/`, `package.json`, and `tsconfig.json` (656 entries; tar SHA-256 `681cc1f044717496ac0beae7e5febd56e7c382a0ea5af110eb8a37e6dd774cba`), not the whole worktree. The preceding six 500s were a test-environment localhost/127.0.0.1 fake URL mismatch, not a production failure. Fourteen of 15 fixture files had then been invoked; the separate MCP-builder receipt below completes the fixture inventory. Neither receipt independently qualifies the C1 aggregate; C1 remains limited to its single 69-path, 17/17 four-theme admission and does not establish “10/10”, ten independently qualified scenarios, full HTTP/MCP integration, provider/network/credential/package qualification, original-worktree bootstrap qualification, whole-worktree or source-to-package provenance, or WP00 closure.

The final MCP-builder fixture receipt qualified `test/e2e/mcp-builder-integration.test.ts` after a test-only lifecycle, diagnostic-oracle, and nullability correction. Real `StdioServerTransport`, legacy dynamic imports, generated-module execution, delayed/hung timeout, and quarantine behavior were preserved; teardown owns and removes its temporary Vault/database/plugin state. The isolated run passed **14/14 tests in three suites**, no skips, and canonical `tsc --noEmit -p tsconfig.json` exited 0. Its full runtime materialization was only `src/`, `test/`, `package.json`, and `tsconfig.json` (657 entries; tar SHA-256 `122da372ccd1125c3a5204120083bdbbd264ec17b780e2bb13c70ec032b49b9e`), not the whole worktree. Final proof SHA-256 `a58f3c7a990647be927874573814d487d399600e2e84ed626e7d0df72ed462b4`; TAP SHA-256 `3f233dfdb814e88d2ecb72526624ee6bf918729e9aeee53c550ab36e84075611`; candidate SHA-256 `31eb172d1d1a9c2490b24f6cdd9d22f61bf96d9631cfd1727ed2aabd61c46948`; nullability patch SHA-256 `b47c98d44a9bc96e8a56d1e707c46cdf4c96a693cb3b8452f03e3c16f25c95c3`; combined initial patch SHA-256 `37a43f1b41a4de00a1f066d8e5d0d95149f847c72d6db5a67c2fd3d7192784a9`. Earlier failed oracle/typecheck runs remain historical harness stages, not production failures. All 15/15 distinct fixture files have now been invoked; C1 narrowly admits only the four themes **post-local freeze**, **duplicate**, **required**, and **late register**. It is not “10/10” or ten independently qualified scenarios, and it does not establish full HTTP/MCP integration, provider/network/credential/package qualification, original-worktree bootstrap qualification, whole-worktree or source-to-package provenance, or WP00 closure.

### Bounded disposable zero-argument bootstrap receipt

A bounded disposable no-network zero-argument bootstrap receipt is now recorded. Node `v22.23.2` used ABI `127`; rebuilt `better_sqlite3.node` was injected only into a temporary physical pnpm target. Readiness reached `MCP server started on stdio`; the application and wrapper both exited `0`; duration was `3.946s`; stdout was `0` bytes; cleanup left no residual process.

- Summary proof SHA-256: `d79605a2f57d2d26814c35f5116b2d9f8d923b285084888ca12d6a9925002f37`.
- Stderr proof SHA-256: `f86b3e87bcc1c43c79329978a59bdc7e67017d47253afcce987249648cd420e9`.
- The original worktree physical pnpm binding remains absent and unmodified. This proves only the disposable rebuilt-artifact candidate, not original-worktree qualification or production/package qualification.

This bounded result reconciles the earlier “zero-argument bootstrap unproven” wording: the disposable candidate is now proven at this narrow boundary, while original-worktree/production qualification remains unproven. C1 directly proves the four-theme aggregate—**post-local freeze**, **duplicate**, **required**, and **late register**—through one 69-path, 17/17 focused receipt. It does not establish “10/10” or ten independently qualified scenarios, full HTTP/MCP integration, provider/network/credential/package qualification, original-worktree bootstrap qualification, whole-worktree or source-to-package provenance, or WP00 closure. `HEALTH-REGISTRY` is **narrowly admitted** for that aggregate only, and WP00 remains open.

### Bounded filtered-projection HTTP/MCP integration receipt (2026-09-11)

One separate single-run receipt passed in the Linux x64/glibc local image `mcp-llm-bridge-wp00-native:local-20260911T153426Z` (`sha256:855cac4d86039b612e453d2b4a64f789aaff17a5c04b39444afc4ae121444bfa`). It used Node `22.23.2` / ABI `127` and the image-native `better-sqlite3` dependency tree. With `network=none`, a read-only, non-root source projection at `/opt/mcp-llm-bridge-native/receipt-repo` contained 291 regular files, excluding host `node_modules` and secrets; cleanup removed the projection. MCP connected; `tools/list` ran exactly once and returned 30 tools. The first local health poll was HTTP 200 with `status: ok`, version `0.6.0`, auth disabled, providers `17/0` (total/available), Anthropic `none`, and mode `proxy`.

Repo HEAD/status/docs configuration were unchanged, and the proof remains at `/tmp/wp00-filtered-receipt-bhf93fos/`. The initial checksum-cwd issue was historical harness bookkeeping corrected before proof verification, not a product failure. This receipt follows the prior C1 four-theme admission but is separate from it: it proves only a bounded shared MCP/HTTP startup, health, and tool-list boundary. It does not claim full HTTP/MCP integration, all tool behavior, provider availability/credentials/network qualification, original host binding, clean package provenance, multi-platform evidence, delivery, WP00 closure, or a 10/10 scenario result.

<!-- evidence:begin -->
- [read] The receipt records one MCP connection, one tools/list call, and 30 returned tools. src=/tmp/wp00-filtered-receipt-bhf93fos/receipt-result.json:2-6
- [read] The receipt records the first HTTP health response and its bounded health fields. src=/tmp/wp00-filtered-receipt-bhf93fos/receipt-result.json:39-60
- [read] The projection manifest records the source/projection boundary, explicit selection, credential scan, and required image identity. src=/tmp/wp00-filtered-receipt-bhf93fos/projection-manifest.json:2-6,1171-1176
- [read] Cleanup records removal of the projection and container. src=/tmp/wp00-filtered-receipt-bhf93fos/cleanup.json:2-8
<!-- evidence:end -->

### Persistent Dev Container MCP/HTTP receipt (2026-09-11)

The persistent reviewed Dev Container harness passed `pnpm run test:wp00:devcontainer` with exit 0. MCP `tools/list` returned **30 tools** and no MCP `tools/call` occurred; loopback `/health` returned HTTP 200 with `status: ok`. This receipt is distinct from the earlier filtered-projection receipt: it retains that receipt's bounded projection scope rather than superseding it.

The already documented Dev Container boundary remains a public pinned image, `network=none`, the `node` user, and isolated workspace dependencies. The runner emitted JSON stdout but did not report a filesystem receipt path, so no new image digest or receipt locator is asserted. Health may perform contained availability checks; this result does not establish real provider calls, generation/provider readiness, external network behavior, cross-platform support, provenance/signing, delivery, or WP00 closure. No `tools/call` means tool execution behavior was not exercised.

<!-- evidence:begin -->
- [executed] The persistent reviewed Dev Container harness passed the bounded MCP/HTTP check. cmd=`pnpm run test:wp00:devcontainer` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
<!-- evidence:end -->

## Next bounded work

| Priority | Scope and status | Acceptance focus |
|---|---|---|
| 1 | `AUTH-BIND-CORS` (W03) is scoped verified for defined bind/CORS behavior; its historical aggregate ID ranges remain undefined, so this is not 16/16 canonical admission. | Preserve the requirements map. Real listener proof is optional only if a later requirement needs it; retain AUTH-RUNTIME and ERR-HTTP-FOUNDATION prerequisites for canonical admission. |
| 2 | `ERR-ACP` (W03) is scoped verified for the defined ten code/message fixtures and raw single-request boundary. | Preserve its request-only limits and acceptance map; no new ERR-ACP work follows automatically. |
| 3 | `ERR-HTTP-ADMIN-A` (W03) is scoped verified for the defined seven-route containment matrix. | Preserve the scoped map; profile/sync remains W04 Admin-B and the aggregate SAFE-HA range remains undefined. No new Admin-A work follows automatically. |
| 4 | `ERR-HTTP-API-A` (W03) is scoped verified for the defined nine-registration API error-containment scope. | Preserve the receipt; it is not aggregate SAFE-HC admission, full auth/runtime proof, or WP00 closure. |
| 5 | `ERR-MCP-SECURITY` (W03) is scoped verified for the defined `wrapHandlers` deny/rate/delegation boundary. | Preserve its receipt and separate universal delegate-failure/ERR-MCP-SERVER gaps; no aggregate MCP-SEC or full runtime claim follows. |
| 6 | `HEALTH-REGISTRY` (W03) has a narrowly admitted C1 aggregate: selected built-in-17/optional-local lifecycle, HTTP/MCP first-operation guards, migrated real-Router fixtures, and one 69-path, 17/17 focused receipt directly covering only **post-local freeze**, **duplicate**, **required**, and **late register**. A separate filtered-projection receipt proves only the shared MCP/HTTP startup-health-tool-list boundary: offline read-only non-root projection, 291 regular files, one tools/list call returning 30 tools, and first health poll HTTP 200/ok. Historical 18/18, 49/49, 109/110, 33/33, 23/23, and 14/14 receipts remain separate bounded evidence. All 15 distinct fixture files were invoked under separate bounded qualifications. | Preserve the narrow C1 admission and keep the new receipt separate. The combined evidence is not “10/10” or ten independently qualified scenarios, full HTTP/MCP integration, all tool behavior, provider/network/credential/package qualification, original host binding/bootstrap qualification, clean package provenance, multi-platform evidence, or WP00 closure. W03 scanner grammar/inventory units remain planning-only; do not aggregate-admit scanner work. |

Macro reconciliation, the gateway delivery-slice inventory, its fresh functional verification, its local commit `87ecd78`, and the diagnostics delivery inventory/limited isolated proof plus local commit `ee9e7d2` are complete. `AUTH-BIND-CORS`, `ERR-ACP`, `ERR-HTTP-ADMIN-A`, `ERR-HTTP-API-A`, and `ERR-MCP-SECURITY` are requirements-scoped verified current-source evidence, not completed canonical units. MCP security covers its defined `wrapHandlers` boundary only; universal delegate-failure containment and ERR-MCP-SERVER remain separate. API-A covers nine registrations across four response-envelope families and an isolated `:memory:` SQLite lifecycle only; it is not aggregate SAFE-HC or persistent-storage proof. ERR-ACP's raw adapter is a single-request boundary, not a general JSON-RPC transport; Admin-A is a seven-route containment matrix, not aggregate SAFE-HA or full-app proof. The separate uncommitted plugin-runtime candidate retains separate historical 39/39 and 1/5 receipts; do not call them 45 checks or historical 71. The test-only ESM emitter correction is complete with fresh worker 5/5, real-worker diagnostics 1/1, and typecheck proof. The read-only retained package inventory is complete: expected tarball identity and historical Worker-entry identity were verified, while current source-to-artifact provenance remains unavailable without a build. The real runtime-composition helper also has a completed isolated 2/2-plus-typecheck receipt; it proves composition with fake leaves, not real initialization, package qualification, or zero-argument wrapper execution with real dependencies. TCP proof preparation is paused after two bounded no-listener/provider failures; it is a follow-up, not an active product priority. These receipts feed the current 68-unit guide; they do not replace canonical acceptance, package qualification, setup closure, review PASS, or WP00 closure. Scanner integration and supply-chain authorization remain out of scope until their real contract is established.
Do not block independent containment on unresolved plugin identity, or confuse source-inferred exposure with newly executed evidence.
The DAG still orders ERR-MCP-DYNAMIC -> ERR-MCP-SECURITY -> ERR-HTTP-SECURITY, and ERR-MCP-SERVER -> ERR-ACP -> ERR-PLUGIN.
Delivered components do not close those canonical predecessors or relax LOG-OPERATIONS dependencies.
MCP/HTTP security, ACP diagnostics and plugin messages are no longer the unimplemented priorities in the preceding snapshot.
Historical ledger indices establish ownership, not current span/hash admission.
Each production fix should start with a failing behavior test; characterization may correctly pass without a production change.

## What can wait without weakening acceptance

Additional scanner precision rules can wait when they do not remove a demonstrated production or integration blocker.
Required grammar, resolution, flow, ownership, suppression and zero-unparsed-root criteria cannot be dropped.
Deferring precision work changes sequencing, not the final acceptance contract.

## Reference and update discipline

- Canonical scope: `openspec/changes/containment-and-evidence-harness/tasks.md`.
- Dependencies/ownership: `openspec/changes/containment-and-evidence-harness/design/scenarios-dag.md`.
- Acceptance contracts: `openspec/changes/containment-and-evidence-harness/design/contracts.md`.
- Historical evidence: `openspec/changes/containment-and-evidence-harness/implementation-handoff.md`.
- Storage regressions: `test/wp00/err-http-storage.test.ts`, `test/wp00/err-http-storage-delete.test.ts`.
- Vault compatibility regressions: `test/vault-audit.test.ts`, `test/vault.test.ts`.
- Focused recent evidence: `test/wp00/log-price-sync.test.ts`, `test/wp00/log-vault-refresh.test.ts`, `test/wp00/log-setup-claude.test.ts`, `test/wp00/log-setup-gateway.test.ts`, `test/wp00/log-vault-audit.test.ts`.
- Setup compatibility regressions: `test/setup/claude-code-setup.test.ts`, `test/setup/gateway-setup.test.ts`.
- Recent boundary evidence: `test/wp00/log-setup-merge.test.ts`, `test/wp00/fixtures/log-setup-merge-child.ts`, `test/wp00/err-plugin-enumeration.test.ts`, `test/mcp-builder/loader.test.ts`.
- Builtin reference: [Node.js 22.23.2 util.types](https://nodejs.org/download/release/v22.23.2/docs/api/util.html#utiltypes); documentation explains the native guard, while the executed matrix supplies observable-trap evidence.
- Test totals above are prior executed handoff evidence; this passive refresh performs structural checks only.

Update this report with a source revision, scoped verification result and explicit remaining limitations.
Do not convert test counts, historical checkboxes or component commit counts into a percentage of WP00 completion.
This standalone report does not modify the six existing planning documents or create SDD lifecycle state.
