# Design: WP-00 Containment and Evidence Harness
## Revision 22 — Current-Main Source Refresh

## Technical Approach

WP-00 preserves the accepted default-deny architecture against tracked commit `f1ad14f6ae8037a52c705838f4bf1d2b9bac766b`. Protocol adapters, cookie administration, immutable provider/evidence state, deterministic scanning, hermetic tests, and publication readback fail private, unavailable, redacted, Unknown, or qualified. Proposed behavior is not executed proof.

## Normative Design Set — Mandatory Reading

This document and all four companions are normative and MUST be read together before tasks, implementation, or verification:

1. [Byte-complete contracts](design/contracts.md)
2. [Baseline ledger](design/baseline-ledger.md)
3. [Execution manifest](design/execution-manifest.md)
4. [Scenarios and dependency DAG](design/scenarios-dag.md)

## Architecture Decisions

| Decision | Choice | Rejected alternative and rationale |
|---|---|---|
| Failure ownership | Semantic codes with independent HTTP/OpenAI/Anthropic/MCP/ACP/plugin projections and one sink owner. | A shared numeric registry corrupts ACP meanings. |
| Admin security | Cookie presence forces Origin/session/CSRF; cookie-absent Bearer is temporary compatibility. Process-local sessions are explicit; multi-process cookie mode fails startup. | Bearer downgrade, Referer fallback, query JWT, or browser storage. |
| Provider liveness | Freeze providers before listen; retain one raw fence per provider and emit bounded immutable snapshots. | Fixed-four concurrency starves later providers when calls hang. |
| Evidence | Exhaustive const-derived schemas include `failed`; catalog/cost/circuit/health wires are additive. | Scalar values and casts permit contradictions. |
| Reproducibility | Versioned paths.bin, RFC-8785 manifest, TypeScript 5.9.3 scanner, 660-record ledger, and separate source/provider/WP-00 hashes. | Grep or unproven hash equality. |
| Distribution | Delete `dist-old/**`; verify temporary dist/package output, SVG provenance, and Buildx config digest/IID. | Quarantine leaves executable roots ambiguous. |

## Data Flow

```text
tracked commit → scanner → immutable binding → root/container evidence
request → credential mode → Origin/session/CSRF → admin handler
providers → raw fences → snapshot → transports → dashboards
dashboard source → temporary build → manifest/readback → tracked docs
```

## File Changes

| Area | Action |
|---|---|
| `src/core/**,src/auth/**,src/server/**,src/acp/**,src/mcp-builder/**` | Add typed owners and migrate ledger sections. |
| `test/contracts/**,test/hermetic/**,Dockerfile.test,scripts/**` | Add scanner, bootstrap, containment, and readback. |
| `dashboard/src/**,docs/index.html,docs/assets/**` | Add cookie/evidence UI and verified assets. |
| `dist-old/**` | Delete all six tracked files. |

## Interfaces / Contracts

The [contracts companion](design/contracts.md) owns types, transitions, Origin/CORS, cookie/CSRF/logout, wire fixtures, parser versions, manifest encoding, and hash domains. The [baseline ledger](design/baseline-ledger.md) is the normalized baseline. Required-provider validation occurs after registration and before listen.

## Testing Strategy

| Layer | Proof |
|---|---|
| Unit | Protocol, parser, auth, state, and evidence fixtures. |
| Integration | Unique scenario owners and serialized shared symbols from [scenarios/DAG](design/scenarios-dag.md). |
| Containment | Sole bootstrap, Docker boundary, and [execution-manifest commands](design/execution-manifest.md#5-exact-buildx-identity-and-run-commands). |
| Final | Canary, generated-byte, and REQ-00 rollback proof after migrations. |

## Threat Matrix

| Boundary | Applicability; safe/failure behavior; RED proof |
|---|---|
| Documentation-like paths | Applicable; classify executable/shebang forms or fail; SCAN-ROOT. |
| Git repository selection | Applicable; one canonical root; reject escapes/second roots; SCAN-BIN. |
| Commit state | Applicable; tracked+untracked inventory, index-independent; staged/empty fixtures. |
| Push state | N/A: no push. |
| PR commands | N/A: no PR command. |

## Migration / Rollout

Land contracts/scanner dark; migrate auth, evidence, and sinks; enable hermetic root and dashboard gates; remove legacy distribution; regenerate/read back assets; verify claims and rollback. Rollback retains loopback, unavailable admin, Unknown evidence, redacted telemetry, disabled sync/publication, and red gates. Planning records `ask-on-risk` resolved as an unchained `size:exception`; this context does not grant review, RDD, commit, push, PR, release, or other delivery authority.

## Planning and Delivery Constraints

`strict_tdd:false` remains the project planning mode. The exact root containment command is normative in [Execution manifest §5](design/execution-manifest.md#5-exact-buildx-identity-and-run-commands). Evidence MUST be candidate-bound and independently validated read-only. SAFE-CORE and SCAN-BIN-01..14 remain unchanged, and existing SCAN-BIN implementation evidence is not a fresh gate approval.

## Open Questions

None.

## Source-Authority Refresh

All 88 ledger paths are byte-identical across the superseded and current commits. Regeneration retained 660 records, 660 unique fixtures, 107 additions, and `sourceEvidenceDigest=sha256:698539835b87ce43208444d994a11ce6670d638ba4f655bd6e61261676072c75`. The immutable tree has 521 records, Git tree `a0c1f03dba152e48458c70a485a0c85f67d26b81`, paths.bin SHA-256 `1684691f152267c73277d56967cf8c9e6f524d26abdd8340b8b0100e684314a6`, and source-authority binding `37f46434e9adf8a30699bb9c86acf190e2f8fb97874cc8bb4df1bf0fc05c05e0`. Provider `subject_hash`, candidate `wp00ArtifactHash`, and `bindingHash` remain unset until candidate freeze.

The 11 changed blobs map as follows: CI timeout environment → CI-ROOT; CLI timeout resolution, Fable 5/5.1, and provider tests → DIST-CLI; 512,000-character prompt assertions → ERR-HTTP-API-A; StubAdapter isolation/suite roots → HERM-FS-T3. HEALTH-REGISTRY validates production IDs only; EVID-MODEL-CORE treats Fable declarations as legacy catalog values until qualified. Recomputed ownership retains 61 units, 127 unique acyclic edges, and 16 exact topological waves, including `HEALTH-REGISTRY → EVID-MODEL-CORE → LOG-ROUTER` and `HEALTH-REGISTRY → DIST-CLI`.

## Audit Result and Risks

Full readback proved all joins, all 107 UTF-16 source slices/Base64/SHA-256 values, the exact JCS preimage, explicit `Dockerfile.test` selection, SVG direction, health IDs, and five-artifact coherence. Implementation must still execute native container containment and repeated deterministic Vite output before capability claims.

## Approved 2026-09-04 gate and developer-container reconciliation

REQ-TEST-01 is unchanged: the exact root command remains a mandatory WP-00 proof. Its owner is **CI-ROOT**, after HERM-RUNNER has made the runner live, bounded, signal-safe, and diagnosable. It is not an AUTH-RUNTIME per-unit prerequisite. AUTH-RUNTIME's scoped completion gate is its normative focused behavior test (test/wp00/auth-runtime.test.ts), applicable scanner/hygiene evidence, and proportional root typecheck; this clarification neither checks AUTH-RUNTIME nor accepts any global-suite result.

The planned developer container is a separate development environment, not a production image and not a substitute for the hermetic evidence image. The planned paths and sole owners are: SCAN-ROOT parses .devcontainer/devcontainer.json execution-bearing fields and .devcontainer/Dockerfile; HERM-IMAGE implements .devcontainer/** while retaining Dockerfile.test as the hermetic evidence image; CI-ROOT owns .node-version, root package.json Node/pnpm declarations, and exact CI pins; CI-DASH owns matching dashboard manifest declarations; CLAIMS-FINAL owns README setup, frozen-install, ABI-volume-reset, and no-default-credentials guidance; DIST-CLI remains responsible only for production Docker/Compose remediation. No planned .devcontainer/** file is asserted to exist yet.

The target developer environment is credential-free, non-root, Node 22.23.2, and pnpm 9.15.9; dependency volumes must be isolated by ABI and reset when the runtime ABI changes. These planned changes preserve the 61-unit, 127-edge, 16-wave graph and the existing unchained size:exception delivery decision.
