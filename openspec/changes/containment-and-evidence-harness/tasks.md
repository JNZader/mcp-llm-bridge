# Tasks: WP-00 Containment and Evidence Harness

OpenSpec authority; planning-only.

## Historical Review Workload Forecast

Estimated changed lines: 11,015–15,855
400-line budget risk: High
Chained PRs recommended: No (only due to explicit approved size exception)
Decision needed before apply: No (risk decision resolved)
Chain strategy: none/not applicable
Delivery strategy: ask-on-risk resolved unchained size exception.

This is the original planning forecast and its then-approved size-exception/unchained consent. It is historical context only: it is **not** approval for the current runtime 29-path candidate, a new build, review, commit, or delivery decision. Use the [Current 68-unit guide](#current-68-unit-guide) for current acceptance/evidence status.

## Normative binding

All rows incorporate complete predecessor, ownership, requirements, scenarios, checks, commands, harnesses, rollback, evidence, and P/F/T estimates by reference to [design/scenarios-dag.md §2–3](design/scenarios-dag.md#2-concrete-work-unit-ledger), [execution-manifest.md](design/execution-manifest.md), and [spec](specs/default-deny-containment/spec.md). Waves are sequential; same-wave work is parallel only when ownership permits. strict_tdd:false. Root: node --import tsx --import ./test/setup/inject-require.mjs --test test/*.test.ts test/**/*.test.ts

Waves: W01 SAFE-CORE,SCAN-BIN; W02 AUTH-RUNTIME,ERR-EXECUTION,ERR-HTTP-FOUNDATION,ERR-MCP-DYNAMIC,ERR-MCP-SERVER,LOG-CORE,SCAN-ROOT-API; W03 AUTH-BIND-CORS,ERR-ACP,ERR-HTTP-ADMIN-A,ERR-HTTP-API-A,ERR-MCP-SECURITY,HEALTH-REGISTRY,SCAN-ROOT-ACTIONS,SCAN-ROOT-COMPOSE,SCAN-ROOT-DOCKER,SCAN-ROOT-INVENTORY,SCAN-ROOT-PACKAGE,SCAN-ROOT-SHELL; W04 AUTH-OAUTH,ERR-HTTP-ADMIN-B,ERR-HTTP-API-B,ERR-HTTP-SECURITY,ERR-PLUGIN,EVID-MODEL-CORE,HEALTH-CORE,SCAN-ROOT; W05 AUTH-CSRF,DIST-CLI,HERM-RUNNER,PUB-BUILD,SCAN-AST,UI-ERROR-REACT; W06 AUTH-ADMIN,HERM-FS-T1,HERM-LOOP,PUB-OLD; W07 HEALTH-HTTP,HERM-CHILD,HERM-FS-T2,SYNC-TRUTH,UI-AUTH-EMBEDDED,UI-AUTH-REACT; W08 AUTH-LOGOUT,EVID-COST,HERM-FS-T3,LOG-BOOTSTRAP,UI-ERROR-EMBEDDED; W09 EVID-CIRCUIT,HERM-IMAGE,LOG-ROUTER; W10 CI-ROOT,EVID-MODEL-TRANSPORT,LOG-SERVICES; W11 ADMIN-OVERVIEW,LOG-OPERATIONS,UI-EVIDENCE-EMBEDDED,UI-EVIDENCE-REACT; W12 GEN-DASH,LOG-ROOT-TOOLS; W13 CI-DASH,TELEMETRY-REQUEST; W14 CLAIMS-FINAL,TELEMETRY-COMPARISON; W15 TELEMETRY-FINAL; W16 FINAL-INTEGRATION.

## Historical admission checklist (68 rows; 8 checked, 60 unchecked)

The checkbox values below preserve original historical admissions. They are not current closure state or a completion percentage; the matching current row is in the [Current 68-unit guide](#current-68-unit-guide).

- [x] 1.1 SAFE-CORE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 1.2 SCAN-BIN [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.1 AUTH-RUNTIME [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.2 ERR-EXECUTION [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.3 ERR-HTTP-FOUNDATION [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.4 ERR-MCP-DYNAMIC [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.5 ERR-MCP-SERVER [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.6 LOG-CORE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 2.7 SCAN-ROOT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 2.8 SCAN-ROOT-API [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.1 AUTH-BIND-CORS [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.2 ERR-ACP [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.3 ERR-HTTP-ADMIN-A [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.4 ERR-HTTP-API-A [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.5 ERR-MCP-SECURITY [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.6 HEALTH-REGISTRY [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.7 HERM-RUNNER [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.8 PUB-BUILD [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.9 SCAN-AST [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.10 SCAN-ROOT-INVENTORY [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.11 SCAN-ROOT-PACKAGE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.12 SCAN-ROOT-SHELL [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.13 SCAN-ROOT-ACTIONS [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.14 SCAN-ROOT-DOCKER [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.15 SCAN-ROOT-COMPOSE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.1 AUTH-OAUTH [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.2 DIST-CLI [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.3 ERR-HTTP-ADMIN-B [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.4 ERR-HTTP-API-B [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.5 ERR-HTTP-SECURITY [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.6 ERR-PLUGIN [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.7 EVID-MODEL-CORE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.8 HEALTH-CORE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.9 HERM-FS-T1 [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.10 HERM-LOOP [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 4.11 PUB-OLD [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 5.1 AUTH-CSRF [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 5.2 HERM-CHILD [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 5.3 HERM-FS-T2 [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 5.4 UI-ERROR-REACT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 6.1 AUTH-ADMIN [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 6.2 HERM-FS-T3 [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 7.1 HEALTH-HTTP [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 7.2 HERM-IMAGE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 7.3 SYNC-TRUTH [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 7.4 UI-AUTH-EMBEDDED [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 7.5 UI-AUTH-REACT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 8.1 AUTH-LOGOUT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 8.2 CI-ROOT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 8.3 EVID-COST [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 8.4 LOG-BOOTSTRAP [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 8.5 UI-ERROR-EMBEDDED [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 9.1 EVID-CIRCUIT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 9.2 LOG-ROUTER [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 10.1 EVID-MODEL-TRANSPORT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 10.2 LOG-SERVICES [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 11.1 ADMIN-OVERVIEW [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 11.2 LOG-OPERATIONS [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 11.3 UI-EVIDENCE-EMBEDDED [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 11.4 UI-EVIDENCE-REACT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 12.1 GEN-DASH [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 12.2 LOG-ROOT-TOOLS [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 13.1 CI-DASH [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 13.2 TELEMETRY-REQUEST [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 14.1 CLAIMS-FINAL [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 14.2 TELEMETRY-COMPARISON [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 15.1 TELEMETRY-FINAL [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 16.1 FINAL-INTEGRATION [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)

SCAN-BIN: independently admitted at sha256:919c0d3062ea4bc26f23f538af593f90b534ea47ba4e2dc5297a3bfc69e65071; 14/14 focused, typecheck, and cached-diff checks passed; DAG dependents may route.

## Provenance

Provenance: #20289, #20398, #20343, #20476 (non-normative).
## Approved 2026-09-04 evidence semantics

The current checklist contains exactly 68 rows: 8 checked and 60 unchecked. `2.1 AUTH-RUNTIME` is admitted and checked after its scoped Node 22 focused-test, typecheck, and hygiene gate. The exact root command remains mandatory REQ-TEST-01 evidence owned later by CI-ROOT, not a per-unit AUTH prerequisite. HERM-RUNNER owns runner liveness, bounded concurrency, teardown/signals, and diagnostic timeouts for that later root gate.

The existing SCAN-ROOT, HERM-IMAGE, CI-ROOT, CI-DASH, CLAIMS-FINAL, and DIST-CLI rows retain their ownership; the seven SCAN-ROOT prerequisite rows are now explicit. The planned .devcontainer/** paths do not yet exist, Dockerfile.test remains the separate hermetic evidence image, and the current topology is 68 units, 139 edges, and 16 waves with the unchained size:exception unchanged. The prior 61-unit/127-edge snapshot is historical only.

<a id="current-68-unit-guide"></a>

## Current 68-unit guide (2026-09-10)

**Use this table for current planning; preserve the checklist above for historical provenance.** Its eight `[x]` markers record historical admissions only. They are not current closure, a percentage, a delivery authorization, or a substitute for candidate-bound validation. The original 68 IDs, checkboxes, dependencies, and waves remain unchanged.

`Historical admitted` means a documented, bounded admission exists. `Scoped verified` means a named contract was executed against an identified candidate, with explicit exclusions; it is not canonical admission. `Partial` means source or focused evidence exists but does not satisfy the canonical unit. `Not assessed` means this reconciliation has no unit-specific current evidence; it does **not** mean the feature is absent. Counts are status inventory only: 8 historical-admitted, 6 scoped-verified, 22 partial, and 32 not-assessed rows; they are deliberately not a progress percentage.

Evidence keys: `DAG§2/§3` = ownership plus exclusive acceptance scenarios in `design/scenarios-dag.md:178-309`; `AUD` = current bounded reconciliation in `../../../docs/audit/2026-09-01/wp00-progress-current.md:118-238`; `ROOT` = execution/root evidence in `design/execution-manifest.md:7-146`; `SPEC` = seven normative requirements in `specs/default-deny-containment/spec.md:5-97`. Every row retains its own locator; no row infers closure from a neighbouring component.

| Canonical unit | Wave | Implementation evidence | Verification state | Remaining acceptance / next action | Locator |
|---|---|---|---|---|---|
| SAFE-CORE | W01 | Present; historical admission. | Historical admitted. | Preserve its fail-closed basis; revalidate only for a new candidate. | Checklist `1.1`; DAG§2; AUD:120-129 |
| SCAN-BIN | W01 | Present; independently admitted binding/codecs. | Historical admitted, focused 14/14 retained. | Preserve binding admission before routing scanner dependents. | Checklist `1.2`; [admission note](#approved-2026-09-04-evidence-semantics); DAG§2/§3 |
| AUTH-RUNTIME | W02 | Present; historical runtime/config foundation. | Historical admitted, scoped. | Revalidate its fail-closed contract before relying on it for W03 auth work. | Checklist `2.1`; AUD:120-129; DAG§2 |
| ERR-EXECUTION | W02 | Present; historical streaming/non-streaming containment slices. | Historical admitted, scoped. | Retain scenario ownership; revalidate exact execution canaries when reopened. | Checklist `2.2`; AUD:120-129; DAG§2/§3 |
| ERR-HTTP-FOUNDATION | W02 | Present; historical HTTP containment foundation. | Historical admitted, scoped. | Revalidate foundation envelopes before W03 HTTP units. | Checklist `2.3`; AUD:120-129; DAG§2/§3 |
| ERR-MCP-DYNAMIC | W02 | Present; historical dynamic MCP containment. | Historical admitted, scoped. | Revalidate raw tool/plugin/error canaries before dependent MCP work. | Checklist `2.4`; AUD:120-129; DAG§2/§3 |
| ERR-MCP-SERVER | W02 | Present; historical MCP-server containment. | Historical admitted, scoped. | Revalidate handler-failure scenarios before ERR-ACP. | Checklist `2.5`; AUD:120-129; DAG§2/§3 |
| LOG-CORE | W02 | Present; historical logger primitives. | Historical admitted, scoped. | Revalidate logger boundary before bootstrap/router work. | Checklist `2.6`; AUD:120-129; DAG§2 |
| SCAN-ROOT-API | W02 | Present; root API and outward-scanner import closure match HEAD/current/scratch. | Scoped verified: SCAN-ROOT-01..02 plus three boundary cases passed 5/5 and `tsc --noEmit` exited 0 on the isolated Node 22 candidate. | Preserve the verified API contract. Independently admit binding/artifact authority before dispatch or aggregate closure; do not treat this as SCAN-BIN/provider admission. | Checklist `2.8`; DAG§2/§3; [final proof](/tmp/scan-root-api-proof-v23rixjq/artifacts/final-proof.json); [test log](/tmp/scan-root-api-proof-v23rixjq/artifacts/scan-root-api.log); [typecheck log](/tmp/scan-root-api-proof-v23rixjq/artifacts/tsc-no-emit.log) |
| AUTH-BIND-CORS | W03 | Present for defined bind/CORS behavior: loopback-default binding, explicit non-loopback gateway-token refusal/allowance, strict CORS preflight policy, peer-trusted XFF resolution, raw origin-only syntax validation before URL canonicalization, and test-only `createHttpApp(...).request()` coverage. Intentional default-port normalization remains compatible. | **Scoped verified** for REQ-HTTP-01 exposure and the defined CORS middleware contract: identified 39-source-path candidate, 21 focused cases in five suites, and canonical `tsc --noEmit`. It is not a canonical 16-ID admission, delivery, or WP00 closure. | Preserve the requirements map and do not invent meanings for aggregate HTTP-BIND-01..06/CORS-01..10 labels. Real `startHttpServerWithDeps`/`serve` proof is optional integration work if a later requirement needs it. Health/OAuth/admin ownership remains separate; AUTH-ADMIN missing credential stays its own unit. | Checklist `3.1`; DAG§2/§3; SPEC:18-29; [acceptance map](../../../docs/audit/2026-09-01/auth-bind-cors-acceptance.md); [current proof](/tmp/auth-bind-cors-production-wiring-final-20260910/artifacts/proof.json) |
| ERR-ACP | W03 | Present for the defined ten code/message fixtures and one raw JSON object-request boundary. `handleRawRequest(rawJson)` reaches parse/invalid-request handling while the typed `handleRequest` remains unchanged. | **Scoped verified:** C2 test-only assertions directly prove zero typed-handler dispatch for malformed and every invalid raw input, including `-32602`; valid input delegates exactly once. Final evidence is 23 focused tests and `tsc --noEmit` exit 0 on the identified 43-source-path candidate. This is not a count of numeric codes or canonical ACP scenario admission. | Preserve the request-only boundary: no batches, notifications, framing, sockets, or transport-compliance claim. Do not reopen it without a new requirement. The current next known W03 row is HEALTH-REGISTRY; preserve the scoped API-A receipt. | Checklist `3.2`; DAG§2/§3; contracts.md:131,133; [acceptance map](../../../docs/audit/2026-09-01/err-acp-acceptance.md); [C2 proof](/tmp/acp-raw-json-dispatch-final-20260910/artifacts/proof.json) |
| ERR-HTTP-ADMIN-A | W03 | Present for seven owned Admin-A registrations: key POST/GET/DELETE, catalog refresh, discover, reset breaker, and flush. | **Scoped verified:** eight injected generic failure invocations return a literal-independent exact generic 500 `INTERNAL_ERROR`; five `NOT_CONFIGURED` branches are preserved. Final evidence is 13 focused tests and `tsc --noEmit` exit 0 on the identified 45-source-path candidate. This does not define or admit aggregate SAFE-HA-01..10 IDs. | Preserve the isolated route boundary; profile/sync behavior belongs to later W04 Admin-B. Preserve the scoped API-A receipt; the current next known W03 row is HEALTH-REGISTRY. Do not reopen either completed scoped receipt without a new requirement. | Checklist `3.3`; DAG§2/§3; [acceptance map](../../../docs/audit/2026-09-01/err-http-admin-a-acceptance.md); [final proof](/tmp/err-http-admin-a-literal-final-20260910/artifacts/final-proof.json) |
| ERR-HTTP-API-A | W03 | Present for nine registrations across four response-envelope families: OpenAI nested, Anthropic envelope, and generate/comparison/groups flat specific envelopes. Only three existing tests changed, to use independent public error literals; no production/configuration or fixture changed. | **Scoped verified** for this defined API-A error-containment scope: seven existing suites passed 198/198 and `tsc --noEmit` exited 0 on the identified 48-source-path candidate. This is not an admission of aggregate SAFE-HC-01..12 labels. | Preserve the requirements-based receipt. Do not assign individual SAFE-HC meanings or turn the tested 512K prompt boundary into an ID claim. Preserve the scoped MCP-security receipt and its separate universal-containment gap. HEALTH-REGISTRY has now invoked all 15 distinct fixtures; its fixture receipts remain scoped and do not establish aggregate admission or WP00 closure. | Checklist `3.4`; DAG§2/§3; [acceptance map](../../../docs/audit/2026-09-01/err-http-api-a-acceptance.md); [proof](/tmp/api-a-oracle-final-20260910/artifacts/proof.json) |
| ERR-MCP-SECURITY | W03 | Present for the defined `ProfileEnforcer.wrapHandlers` deny/rate boundary. Existing focused fixture covers literal denial/rate projection, denial before quota and delegation, hostile `retryAfter` non-inspection, filtering/dynamic metadata, and successful/default arguments. | **Scoped verified:** 7/7 focused tests in one suite and `tsc --noEmit` exited 0 on the identified 50-path candidate. This is not an admission of aggregate MCP-SEC-01..06. | Preserve the scoped receipt and the separate universal delegate-failure containment gap; ERR-MCP-SERVER remains independently unproven. HEALTH-REGISTRY has now invoked all 15 distinct fixtures; its fixture receipts remain scoped and do not establish aggregate admission or WP00 closure. | Checklist `3.5`; DAG§2/§3; [acceptance map](../../../docs/audit/2026-09-01/err-mcp-security-acceptance.md); [proof](/tmp/mcp-security-focused-20260910/artifacts/proof.json) |
| HEALTH-REGISTRY | W03 | Partial: selected built-in-17/optional-local membership, core/post-local freeze lifecycle, and first-operation HTTP/MCP frozen-registry guards are implemented. Fifteen existing HTTP/MCP fixtures now use the real Router/freeze lifecycle; membership does not probe credentials or availability. | Executed focused startup scope: independent literal membership oracle plus negative unfrozen-zero-other-dependency and positive frozen-sentinel checks passed 17/17 in four suites; `tsc --noEmit` exited 0 on the 69-path identified candidate. Separately, earlier consents passed 18/18, 49/49, and historical 109/110 StubAdapter receipts; the CORS/local-LLM receipt passed 33/33 in 18 suites with no skips plus `tsc --noEmit`; the discovery-DI fixtures passed 23/23 in seven suites with no skips plus canonical `tsc --noEmit`; the MCP-builder fixture passed 14/14 in three suites with no skips plus canonical `tsc --noEmit`. All 15 distinct fixture files were invoked. This is not aggregate `HEALTH-REG-01..10` admission, full HTTP/MCP integration, provider/network/package qualification, or WP00 closure. | All fixture slices are scoped verified, including the MCP-builder test-only lifecycle/oracle/nullability correction with real Stdio and dynamic timeout/quarantine behavior preserved. The next action is exclusively a read-only reconciliation of remaining aggregate evidence obligations and whether any source change is actually required; do not execute new fixture work automatically. Do not advance scanner work from this partial row. | Checklist `3.6`; DAG§2/§3; [reconciliation](../../../docs/audit/2026-09-01/health-registry-reconciliation.md); [MCP-builder proof](/tmp/mcp-builder-null-correction-final-20260910-01/artifacts/final-proof.json) |
| SCAN-ROOT-ACTIONS | W03 | Partial; format component evidence exists. | Historical/component only. | Prove Actions execution subset and YAML rejection SCAN-ROOT-09..10. | Checklist `3.13`; AUD:167-169; DAG§2/§3; ROOT:25 |
| SCAN-ROOT-COMPOSE | W03 | Partial; format component evidence exists. | Historical/component only. | Prove Compose subset and unsupported-field rejection SCAN-ROOT-13..14. | Checklist `3.15`; AUD:167-169; DAG§2/§3; ROOT:25 |
| SCAN-ROOT-DOCKER | W03 | Partial; format component evidence exists. | Historical/component only. | Prove Dockerfile execution forms/directives SCAN-ROOT-11..12. | Checklist `3.14`; AUD:167-169; DAG§2/§3; ROOT:25 |
| SCAN-ROOT-INVENTORY | W03 | Partial; inventory component exists. | Historical/component only. | Prove Git/untracked modes, special files and symlink containment SCAN-ROOT-03..04. | Checklist `3.10`; AUD:166-169; DAG§2/§3; ROOT:7-25 |
| SCAN-ROOT-PACKAGE | W03 | Partial; package format component exists. | Historical/component only. | Prove strict package/devcontainer JSON roots SCAN-ROOT-05..06. | Checklist `3.11`; AUD:167-169; DAG§2/§3; ROOT:25 |
| SCAN-ROOT-SHELL | W03 | Partial; shell format component exists. | Historical/component only. | Prove bounded shell grammar and dynamic rejection SCAN-ROOT-07..08. | Checklist `3.12`; AUD:167-169; DAG§2/§3; ROOT:25 |
| AUTH-OAUTH | W04 | Not assessed for canonical OAuth contract. | Pending. | Implement/prove origin, state, allowlist and no-query-JWT OAUTH-01..12/ORIGIN-01..18. | Checklist `4.1`; AUD:192-206; DAG§2/§3; SPEC:31-42 |
| ERR-HTTP-ADMIN-B | W04 | Partial; sync/approvals slices exist. | Historical/scoped aggregate gap. | Close all admin-B sync/profile/shell scenarios SAFE-HB-01..14. | Checklist `4.3`; AUD:134-137,184-190; DAG§2/§3 |
| ERR-HTTP-API-B | W04 | Partial; storage/observability/cost/tooling slices exist. | Historical/scoped aggregate gap. | Close assigned API-B routes and SAFE-HD-01..14. | Checklist `4.4`; AUD:130,139-148,184-190; DAG§2/§3 |
| ERR-HTTP-SECURITY | W04 | Partial; fixed-403 characterization exists. | Historical/scoped; authentication redesign absent. | Close HTTP security acceptance without broadening exposure. | Checklist `4.5`; AUD:149-150,184-190; DAG§2/§3; SPEC:18-42 |
| ERR-PLUGIN | W04 | Partial; fixed messages and bounded worker evidence exist. | Scoped; scanner identity/provenance unresolved. | Close PLUGIN-01..08 with scanner-issued identity binding; do not equate archive/package evidence with this unit. | Checklist `4.6`; AUD:152,192-195; DAG§2/§3 |
| EVID-MODEL-CORE | W04 | Partial; local-model metadata slices exist. | Historical/scoped. | Implement/prove missing-vs-known model evidence MODEL-CORE-01..12. | Checklist `4.7`; AUD:140-142,192-206; DAG§2/§3; SPEC:44-63 |
| HEALTH-CORE | W04 | Not assessed for snapshot/fence unit. | Pending. | Implement/prove hung, queued, TTL and cancellation HEALTH-FENCE-01..14. | Checklist `4.8`; AUD:192-206; DAG§2/§3 |
| SCAN-ROOT | W04 | Partial; classification/reporting components exist. | Not aggregate admission proof. | Dispatch every root once, bind trusted records and prove zero unparsed roots SCAN-ROOT-15..16. | Checklist `2.7`; AUD:168,207-217; DAG§2/§3; ROOT:25 |
| AUTH-CSRF | W05 | Not assessed for canonical CSRF behavior. | Pending. | Implement/prove cookie-first, rotation and stale/duplicate rejection CSRF-01..16. | Checklist `5.1`; AUD:192-206; DAG§2/§3 |
| DIST-CLI | W05 | Not assessed for current distribution/CLI contract. | Pending. | Prove required versus optional CLI readiness DIST-CLI-01..10. | Checklist `4.2`; AUD:230-238; DAG§2/§3; SPEC:86-97 |
| HERM-RUNNER | W05 | Not assessed; only planned manifest ownership. | Pending, no fresh hermetic run. | Implement sole bootstrap, discovery, teardown and signals HERM-ROOT-01..12. | Checklist `3.7`; AUD:230-238; DAG§2/§3; ROOT:53-73 |
| PUB-BUILD | W05 | Not assessed; publication contract is planned. | Pending. | Build to temporary output and prove package membership/bytes PUB-BUILD-01..12. | Checklist `3.8`; AUD:230-238; DAG§2/§3; ROOT:27-52 |
| SCAN-AST | W05 | Partial; parser/reporting components exist. | Historical/component; whole-program closure absent. | Resolve aliases/wrappers/flows/suppressions and resource limits SCAN-AST-01..18. | Checklist `3.9`; AUD:169,219-228; DAG§2/§3 |
| UI-ERROR-REACT | W05 | Not assessed for canonical UI error unit. | Pending. | Implement/prove Groups/Settings/WiringSprint constant-copy behavior. | Checklist `5.4`; AUD:192-206; DAG§2/§3 |
| AUTH-ADMIN | W06 | Not assessed for canonical admin authentication. | Pending. | Implement/prove missing/invalid/precedence middleware ADMIN-01..10. | Checklist `6.1`; AUD:192-206; DAG§2/§3; SPEC:31-42 |
| HERM-FS-T1 | W06 | Not assessed; manifest lists planned ownership. | Pending. | Migrate exact T1 roots with isolated suite state. | Checklist `4.9`; AUD:230-238; DAG§2; ROOT:74-85 |
| HERM-LOOP | W06 | Not assessed. | Pending. | Implement/prove admitted loopback registry and leak controls HERM-LOOP-01..10. | Checklist `4.10`; AUD:230-238; DAG§2/§3; ROOT:53-73 |
| PUB-OLD | W06 | Not assessed. | Pending. | Delete exactly six legacy outputs and prove no stale root edge PUB-OLD-01..07. | Checklist `4.11`; AUD:230-238; DAG§2/§3; ROOT:27-52 |
| HEALTH-HTTP | W07 | Not assessed for canonical health wiring. | Pending. | Prove one snapshot ID and no-false-green HEALTH-WIRE-01..10. | Checklist `7.1`; AUD:192-206; DAG§2/§3 |
| HERM-CHILD | W07 | Not assessed. | Pending. | Implement/prove child capability admission HERM-CHILD-01..12. | Checklist `5.2`; AUD:230-238; DAG§2/§3; ROOT:53-73 |
| HERM-FS-T2 | W07 | Not assessed; manifest lists planned ownership. | Pending. | Migrate exact T2 roots with isolated suite state. | Checklist `5.3`; AUD:230-238; DAG§2; ROOT:74-85 |
| SYNC-TRUTH | W07 | Partial; sync actions/logging exist. | Historical/scoped; startup truth unclosed. | Prove auto-sync off and explicit admin action SYNC-START-01..05. | Checklist `7.3`; AUD:134-137,154-158; DAG§2/§3; SPEC:78-84 |
| UI-AUTH-EMBEDDED | W07 | Not assessed for canonical embedded auth UI. | Pending. | Implement/prove cookie/CSRF/no-storage AUTH-EMBED-01..08. | Checklist `7.4`; AUD:192-206; DAG§2/§3 |
| UI-AUTH-REACT | W07 | Not assessed for canonical React auth UI. | Pending. | Implement/prove cookie/CSRF/no-storage AUTH-REACT-01..08. | Checklist `7.5`; AUD:192-206; DAG§2/§3 |
| AUTH-LOGOUT | W08 | Not assessed for canonical logout flow. | Pending. | Implement/prove valid/stale clear and retry LOGOUT-01..10. | Checklist `8.1`; AUD:192-206; DAG§2/§3 |
| EVID-COST | W08 | Partial; cost route slices exist. | Historical/scoped evidence semantics unclosed. | Prove missing/known/stale cost states COST-01..10. | Checklist `8.3`; AUD:141,192-206; DAG§2/§3; SPEC:44-63 |
| HERM-FS-T3 | W08 | Not assessed; manifest lists planned ownership. | Pending. | Migrate exact T3 roots with isolated suite state. | Checklist `6.2`; AUD:230-238; DAG§2; ROOT:74-85 |
| LOG-BOOTSTRAP | W08 | Partial; setup/logging slices exist. | Historical/scoped. | Close exact bootstrap logging paths after auth/health prerequisites. | Checklist `8.4`; AUD:153-162,262-281; DAG§2 |
| UI-ERROR-EMBEDDED | W08 | Not assessed for canonical embedded error UI. | Pending. | Implement/prove embedded error/toast constant-copy acceptance. | Checklist `8.5`; AUD:192-206; DAG§2 |
| EVID-CIRCUIT | W09 | Partial; circuit route slice exists. | Historical/scoped evidence semantics unclosed. | Prove missing versus known CLOSED CIRCUIT-01..10. | Checklist `9.1`; AUD:144,192-206; DAG§2/§3; SPEC:44-63 |
| HERM-IMAGE | W09 | Not assessed; planned test image is not a build. | Pending. | Build/prove non-root, no-network, read-only image HERM-IMG-01..12. | Checklist `7.2`; AUD:230-238; DAG§2/§3; ROOT:53-73 |
| LOG-ROUTER | W09 | Not assessed for canonical router logging. | Pending. | Close exact router/comparison logging paths. | Checklist `9.2`; AUD:262-281; DAG§2 |
| CI-ROOT | W10 | Not assessed; root command is planned evidence. | Pending. | Run/prove root hermetic suite and clean tree HERM-CI-01..10. | Checklist `8.2`; AUD:230-238; DAG§2/§3; ROOT:87-118 |
| EVID-MODEL-TRANSPORT | W10 | Partial; metadata/local-model slices exist. | Historical/scoped evidence semantics unclosed. | Prove cache/router/HTTP/admin/MCP transport MODEL-XPORT-01..14. | Checklist `10.1`; AUD:140-142,192-206; DAG§2/§3 |
| LOG-SERVICES | W10 | Not assessed for canonical service logging. | Pending. | Close exact service logging paths. | Checklist `10.2`; AUD:262-281; DAG§2 |
| ADMIN-OVERVIEW | W11 | Not assessed for canonical overview assembly. | Pending. | Prove overview/providers/sessions/router old/new fixtures. | Checklist `11.1`; AUD:192-206; DAG§2/§3 |
| LOG-OPERATIONS | W11 | Partial; operational warning and setup slices exist. | Historical/scoped aggregate gap. | Close remaining assigned operations paths without changing intended output. | Checklist `11.2`; AUD:153-162,262-281; DAG§2 |
| UI-EVIDENCE-EMBEDDED | W11 | Not assessed for canonical embedded evidence UI. | Pending. | Implement/prove Unknown evidence projections. | Checklist `11.3`; AUD:192-206; DAG§2/§3; SPEC:44-63 |
| UI-EVIDENCE-REACT | W11 | Not assessed for canonical React evidence UI. | Pending. | Implement/prove Unknown evidence projections. | Checklist `11.4`; AUD:192-206; DAG§2/§3; SPEC:44-63 |
| GEN-DASH | W12 | Not assessed; generation contract is planned. | Pending. | Regenerate/read back exact assets and source/build/output relation GEN-DASH-01..10. | Checklist `12.1`; AUD:230-238; DAG§2/§3; ROOT:27-52,119-137 |
| LOG-ROOT-TOOLS | W12 | Not assessed. | Pending. | Close two root page-index script logging paths. | Checklist `12.2`; AUD:262-281; DAG§2 |
| CI-DASH | W13 | Not assessed; dashboard job is planned. | Pending. | Prove static source/built/tracked comparison DASH-CI-01..10. | Checklist `13.1`; AUD:230-238; DAG§2/§3; ROOT:119-137 |
| TELEMETRY-REQUEST | W13 | Partial; logging/response projections exist. | Historical/scoped; durable privacy unclosed. | Prove request writer/reader metadata-only behavior and canary exclusion. | Checklist `13.2`; AUD:207-228; DAG§2; SPEC:44-51 |
| CLAIMS-FINAL | W14 | Not assessed; claims contract is planned. | Pending. | Verify README/dashboard generated-byte claims CLAIM-01..10. | Checklist `14.1`; AUD:230-238; DAG§2/§3; ROOT:27-52,138-146 |
| TELEMETRY-COMPARISON | W14 | Partial; comparison history/actions slices exist. | Historical/scoped; durable fields unclosed. | Prove safe comparison durable fields after request telemetry. | Checklist `14.2`; AUD:146-148,207-228; DAG§2 |
| TELEMETRY-FINAL | W15 | Not assessed for final canary integration. | Pending. | Prove all sink migrations and zero unowned sink TELEMETRY-CANARY-01..08. | Checklist `15.1`; AUD:207-228; DAG§2/§3; SPEC:44-51 |
| FINAL-INTEGRATION | W16 | Not assessed; no final integration run. | Pending; all predecessors required. | Execute only after CI-ROOT, TELEMETRY-FINAL, CLAIMS-FINAL, AUTH-LOGOUT and ADMIN-OVERVIEW close. | Checklist `16.1`; AUD:230-238; DAG§2/§3; SPEC:5-15 |

### Current evidence queue (not implementation permission)

1. **AUTH-BIND-CORS (W03):** requirements-based bind/CORS behavior is scoped verified; the durable acceptance map records exact coverage and exclusions. Do not invent individual meanings for the aggregate HTTP-BIND/CORS labels or repeat helper work. Real listener proof is optional only when a later requirement calls for it. Historical AUTH-RUNTIME and ERR-HTTP-FOUNDATION remain prerequisites for canonical admission.
2. **ERR-ACP (W03):** the approved raw single-request boundary is scoped verified: the ten code/message inventory is preserved, final focused evidence is 23/23 plus `tsc --noEmit`, and no full transport claim was made. Keep its acceptance map as the boundary; do not reopen it without a new requirement.
3. **ERR-HTTP-ADMIN-A (W03):** defined route containment is scoped verified: eight literal-independent generic failure invocations and five `NOT_CONFIGURED` branches passed 13 focused tests plus `tsc --noEmit`. Its aggregate SAFE-HA range remains undefined; profile/sync belongs to W04 Admin-B. Do not reopen without a new requirement.
4. **ERR-HTTP-API-A (W03):** the defined nine-registration API error-containment scope is scoped verified by seven existing suites (198/198) and `tsc --noEmit` on the 48-source-path candidate. Preserve its receipt; it is not aggregate SAFE-HC admission, full auth/runtime proof, or WP00 closure.
5. **ERR-MCP-SECURITY (W03):** defined `wrapHandlers` deny/rate/delegation behavior is scoped verified by 7/7 focused tests plus `tsc --noEmit` on the 50-path candidate. Preserve its separate universal delegate-failure and ERR-MCP-SERVER gaps; it is not MCP-SEC aggregate admission or full runtime proof.
6. **HEALTH-REGISTRY (W03):** preserve the executed core/post-local/startup-guard receipt, migrated real-Router fixtures, separately consented 18/18 and 49/49 receipts, the historical StubAdapter receipt (109/110), the CORS/local-LLM receipt (33/33 in 18 suites plus `tsc --noEmit`), the discovery-DI receipt (23/23 in seven suites plus `tsc --noEmit`), and the final MCP-builder receipt (14/14 in three suites plus `tsc --noEmit`). All 15 distinct fixture files were invoked. The fixture slices remain scoped verified only: aggregate `HEALTH-REG-01..10`, full HTTP/MCP integration, provider/network/package qualification, and WP00 closure remain open. Next is exclusively a read-only reconciliation of those aggregate obligations and whether any source change is actually required. SCAN-ROOT W03 grammar/inventory work remains planning-only: SCAN-ROOT-API's isolated proof does not admit aggregate scanner dispatch, authority, grammar, or provider behavior.

Before any implementation, revalidate the selected unit's current candidate and prerequisites. This queue neither changes waves nor authorizes SDD, RDD, review, build, delivery, or a completion claim.
