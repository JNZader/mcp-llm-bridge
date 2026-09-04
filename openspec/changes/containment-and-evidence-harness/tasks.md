# Tasks: WP-00 Containment and Evidence Harness

OpenSpec authority; planning-only.

## Review Workload Forecast

Estimated changed lines: 11,015–15,855
400-line budget risk: High
Chained PRs recommended: No (only due to explicit approved size exception)
Decision needed before apply: No (risk decision resolved)
Chain strategy: none/not applicable
Delivery strategy: ask-on-risk resolved unchained size exception.

## Normative binding

All rows incorporate complete predecessor, ownership, requirements, scenarios, checks, commands, harnesses, rollback, evidence, and P/F/T estimates by reference to [design/scenarios-dag.md §2–3](design/scenarios-dag.md#2-concrete-work-unit-ledger), [execution-manifest.md](design/execution-manifest.md), and [spec](specs/default-deny-containment/spec.md). Waves are sequential; same-wave work is parallel only when ownership permits. strict_tdd:false. Root: node --import tsx --import ./test/setup/inject-require.mjs --test test/*.test.ts test/**/*.test.ts

Waves: W01 SAFE-CORE,SCAN-BIN; W02 AUTH-RUNTIME,ERR-EXECUTION,ERR-HTTP-FOUNDATION,ERR-MCP-DYNAMIC,ERR-MCP-SERVER,LOG-CORE,SCAN-ROOT; W03 AUTH-BIND-CORS,ERR-ACP,ERR-HTTP-ADMIN-A,ERR-HTTP-API-A,ERR-MCP-SECURITY,HEALTH-REGISTRY,HERM-RUNNER,PUB-BUILD,SCAN-AST; W04 AUTH-OAUTH,DIST-CLI,ERR-HTTP-ADMIN-B,ERR-HTTP-API-B,ERR-HTTP-SECURITY,ERR-PLUGIN,EVID-MODEL-CORE,HEALTH-CORE,HERM-FS-T1,HERM-LOOP,PUB-OLD; W05 AUTH-CSRF,HERM-CHILD,HERM-FS-T2,UI-ERROR-REACT; W06 AUTH-ADMIN,HERM-FS-T3; W07 HEALTH-HTTP,HERM-IMAGE,SYNC-TRUTH,UI-AUTH-EMBEDDED,UI-AUTH-REACT; W08 AUTH-LOGOUT,CI-ROOT,EVID-COST,LOG-BOOTSTRAP,UI-ERROR-EMBEDDED; W09 EVID-CIRCUIT,LOG-ROUTER; W10 EVID-MODEL-TRANSPORT,LOG-SERVICES; W11 ADMIN-OVERVIEW,LOG-OPERATIONS,UI-EVIDENCE-EMBEDDED,UI-EVIDENCE-REACT; W12 GEN-DASH,LOG-ROOT-TOOLS; W13 CI-DASH,TELEMETRY-REQUEST; W14 CLAIMS-FINAL,TELEMETRY-COMPARISON; W15 TELEMETRY-FINAL; W16 FINAL-INTEGRATION.

## Canonical units (61 rows; 5 checked, 56 unchecked)

- [x] 1.1 SAFE-CORE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 1.2 SCAN-BIN [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.1 AUTH-RUNTIME [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.2 ERR-EXECUTION [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [x] 2.3 ERR-HTTP-FOUNDATION [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 2.4 ERR-MCP-DYNAMIC [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 2.5 ERR-MCP-SERVER [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 2.6 LOG-CORE [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 2.7 SCAN-ROOT [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.1 AUTH-BIND-CORS [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.2 ERR-ACP [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.3 ERR-HTTP-ADMIN-A [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.4 ERR-HTTP-API-A [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.5 ERR-MCP-SECURITY [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.6 HEALTH-REGISTRY [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.7 HERM-RUNNER [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.8 PUB-BUILD [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
- [ ] 3.9 SCAN-AST [DAG§2](design/scenarios-dag.md#2-concrete-work-unit-ledger)
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

The checklist remains exactly 61 rows: 5 checked and 56 unchecked. `2.1 AUTH-RUNTIME` is admitted and checked after its scoped Node 22 focused-test, typecheck, and hygiene gate. The exact root command remains mandatory REQ-TEST-01 evidence owned later by CI-ROOT, not a per-unit AUTH prerequisite. HERM-RUNNER owns runner liveness, bounded concurrency, teardown/signals, and diagnostic timeouts for that later root gate.

The existing SCAN-ROOT, HERM-IMAGE, CI-ROOT, CI-DASH, CLAIMS-FINAL, and DIST-CLI rows incorporate the planned developer-container ownership in design/scenarios-dag.md and design/execution-manifest.md; no additional task row or dependency is created. The planned .devcontainer/** paths do not yet exist, Dockerfile.test remains the separate hermetic evidence image, and the 61-unit/127-edge/16-wave topology and unchained size:exception remain unchanged.
