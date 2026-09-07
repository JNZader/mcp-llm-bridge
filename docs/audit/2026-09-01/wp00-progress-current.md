# WP00: current progress and the next production fixes

WP00 has delivered verified components and storage, execution, observability and administrative error-containment fixes, but it is not closed.
The next priority is resolving plugin identity prerequisites and remaining operational projections, not repeating delivered containment or adding isolated scanner precision rules.
This report separates implemented behavior from the evidence still required for canonical unit closure.

## Snapshot and evidence boundaries

- Reconciliation date: **2026-09-07**; the directory retains the original audit date.
- Source snapshot: **`8c4030ed`**, `fix(plugins): contain loader diagnostic messages`.
- Latest recorded verification: **1271 tests in the selected verification scope, typecheck and normal commit hooks passed**.
- Latest handoff groups: combined 1004, legacy 88, server 2, other regressions 62, comparison 30, security 35, ACP 35 and loader 15.
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
- Its eight checked rows are historical bookkeeping, not a current completion percentage.
- Recent implementation used the DIRECT route. It did not update historical SDD completion or attempt state.
- RDD remains disabled for this clone. No review approval is implied by implementation or functional verification.
- Unknown or unverified WP00 completion does not mean the corresponding product feature is absent.

The source reconciliation was bounded: plan, handoff, relevant commits, scanner modules/tests, and selected HTTP routes.
It was not a fresh audit of every historical foundation or all production code.

## Quick path

1. Resolve the missing authority and identity contract before wiring opaque plugin IDs; do not invent an issuer.
2. Continue bounded operational logging work while that integration remains unresolved.
3. Keep outer filesystem failures and import cancellation explicit separate scopes, with compatibility evidence before changes.
4. Return to scanner integration when it removes a concrete closure blocker, not merely to add precision.

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
| Plugin messages (partial) | `8c4030ed` | Four fixed issue messages and private per-import timeout identity; raw identity fields, outer filesystem errors and import cancellation remain unresolved. |
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
Plugin proxy coverage compares the loader against native .mjs import behavior; it proves no additional loader inspection, not zero engine inspection.
Execution fixes do not certify every API-A projection or upstream exception normalization.
No handler-level regression suite establishes authentication, CSRF or whole-product safety.
Vault's internal audit messages were preserved for compatibility; these fixes do not establish log sanitization.
Component commits do not automatically satisfy every scenario attached to a canonical row.

## Mandatory closure work still outstanding

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

| Observed source | Current behavior | Missing integration prerequisite |
|---|---|---|
| `src/mcp-builder/loader.ts:PluginLoadIssue,loadPlugins` | Accepts only a directory; issues contain filename-derived plugin/file and optional raw toolName. | An independently admitted mapping from the exact candidate plugin/tool identities to scanner-issued opaque IDs. |
| `src/server/mcp-server.ts:startMcpServer,getDynamicPluginLoadSummary` | Copies loader errors/skips into the exported summary; also exposes directory, loaded names/toolNames and collisions. | An explicit public projection and compatibility decision across those fields, not merely replacement of message strings. |
| `src/server/mcp.ts` | Re-exports the summary accessor; the bounded source search found no other production caller. | Consumer verification must include external callers; absence of another internal caller does not make the export private. |
| `test/contracts/scanner/root-batch-dispatch.mjs:createRootBatchDispatcher` | Requires an independently admitted existing snapshot; checks inventory and hashes and dispatches roots. | This local verification seam is neither a first-run issuer nor a plugin/tool ID registry. |
| `src/server/mcp-server.ts:dynamicPluginOperationEvent` | Logging projection already reports counts rather than raw loader issue contents. | Preserve this existing containment; do not infer that all plugin summary consumers are equally contained. |

No production scanner-issued plugin/tool ID input was found in these inspected interfaces.
The required issuer/binding must cover path, mode, bytes/hash, candidate scope and stable tool association before import.
External plugin directories and dynamically produced tool definitions cannot be assumed covered by a repository snapshot.
Missing, stale, duplicate or ambiguous bindings need an explicitly approved fail-closed behavior and tests before wiring.
Filename hashes, local counters, historical test catalog entries or caller-created self-hashes do not supply that authority.
The current scanner's resource, grammar and admission gaps above remain unchanged.
A complete identity integration is not honestly scoped as one ready sub-400-line change from the evidence available here.

## Next bounded work

| Priority | Scope and status | Acceptance focus |
|---|---|---|
| 1 | Plugin identity prerequisites: mapping above is read-only evidence, not an implemented registry or approved schema. | Identify the real issuer and immutable binding/consumer contract before any production ID wiring; no fake admission. |
| 2 | LOG-OPERATIONS candidate: `src/security/enforcer.ts:filterTools,authorize,securityProfileMiddleware` still passes raw tool/path fields to logger calls. | Inspect existing logger serialization before claiming an emitted leak; then scope a focused operational-event fix preserving denial decisions and useful finite metadata. |
| 3 | Loader filesystem/lifecycle follow-up: `loadPlugins` still inspects outer filesystem error.code and rethrows non-ENOENT; timed-out imports continue running. | Preserve missing-directory compatibility; distinguish safe filesystem-error projection from actual execution cancellation, which needs a separate boundary. |

The smallest concrete next implementation candidate is the security operational-log slice, estimated 150–220 lines including focused tests, subject to a bounded logger/contract readback first.
Do not block that independent work on unresolved plugin identity, or label logger call arguments as proven emitted payload without checking the serializer.
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

Update this report with a source revision, scoped verification result and explicit remaining limitations.
Do not convert test counts, historical checkboxes or component commit counts into a percentage of WP00 completion.
This standalone report does not modify the six existing planning documents or create SDD lifecycle state.
