# Proposal: Telemetry Sink Protection

**Change**: `telemetry-sink-protection`  
**Status**: Draft proposal  
**Artifact store**: OpenSpec

## Executive Decision

Protect actual telemetry sinks with typed, fail-closed sink-boundary contracts and producer-side sanitization. SAFE-CORE is not part of this closure, and this proposal MUST NOT claim W01/WP00 completion.

## Intent

The repository has multiple telemetry producers, durable stores, exporters, and readback APIs with inconsistent payload boundaries. Request/response content and provider error text can currently enter durable records, ordinary logs, traces, comparisons, and API projections. This change establishes a uniform metadata-only default while preserving explicitly authorized comparison capability and compatibility-safe usage responses.

## Scope

### In Scope

- Define typed safe projections for request logs, usage, analytics, ordinary logs, traces, metrics, and readback adapters.
- Prevent prompts, responses, credentials, authorization material, arbitrary context, and provider free-text errors from reaching protected telemetry sinks.
- Retain only opaque identifiers for telemetry and readback; identity, project, provider, model, route, and correlation fields require an explicit exposure/scoping decision.
- Preserve `usage.errorMessage` as a compatibility-safe value while adding a safe error code/category; provider free text MUST NOT be propagated into it or other telemetry.
- Treat existing sensitive rows as legacy data: no new writes and no routine readback, with an explicit isolation and deletion/migration procedure.
- Keep comparison prompts and responses only behind an explicitly authorized capability with a distinct authorization boundary, auditability, and retention/deletion controls.
- Set retention to 30 days independently for request logs, usage, analytics, authorized comparison history, ordinary logs, traces, and metrics.
- Provide explicit deletion controls and verification evidence for every sink/exporter, including durable stores and configured external log, trace, and metric backends.
- Update affected HTTP, MCP, dashboard, migration, schema, exporter, and test contracts without changing SAFE-CORE scope.

### Out of Scope / Non-Goals

- Closing, modifying, or claiming completion of SAFE-CORE, W01, or WP00.
- Legal, regulatory, jurisdictional, or compliance conclusions. The 30-day durations are maintainer decisions, not external-evidence claims.
- Removing the explicitly authorized comparison capability by default.
- Reconstructing arbitrary historical payloads into sanitized values when purge or legacy isolation is safer.
- Implementing authentication or tenant isolation without verifying and specifying the repository's actual surrounding boundary; this proposal requires the boundary to be explicit where readback is exposed.
- Source implementation, specs, design, task breakdown, tests, builds, migrations, or deployment changes in this phase.

## Invariants

1. Protected telemetry sinks accept bounded typed metadata, not arbitrary request/response payloads.
2. No prompt, system prompt, response, credential, authorization material, arbitrary context, or provider free-text error reaches ordinary telemetry, logs, traces, metrics, usage, or unauthorized readback.
3. Telemetry and readback expose opaque IDs only unless a separately authorized product contract says otherwise.
4. Existing sensitive rows are legacy-isolated, receive no new writes, and are unavailable to routine readback.
5. Comparison content is available only through explicit capability authorization; it is never an incidental property of ordinary telemetry or history endpoints.
6. Each sink/exporter has an independently named 30-day retention policy, an owning deletion control, and a verifiable completion signal.
7. Compatibility projections remain deliberate: clients may receive a stable safe `errorMessage` and a safe code/category, never provider free text.

## Approach

1. Introduce shared typed sink contracts and safe projections at the actual durable-writer, exporter, logger, tracer, metric, and readback boundaries.
2. Normalize provider failures once into stable codes/categories and bounded compatibility text; treat all other provider detail as internal diagnostic data that cannot cross a protected boundary.
3. Add defense-in-depth producer sanitization and retain existing redaction only as a secondary control, not as the contract.
4. Define migrations for new schema constraints and legacy handling. Prefer isolation or purge over lossy backfill for rows containing arbitrary JSON or text.
5. Gate comparison persistence/readback behind an explicit capability and separate authorization path; ordinary observability projections remain metadata-only.
6. Add negative tests for each sink and compatibility tests for public projections, plus deletion and verification controls per sink/exporter.

## Compatibility and Migration Requirements

| Concern | Required treatment |
|---|---|
| Usage API | Keep a compatibility-safe `errorMessage` field and add a stable safe code/category. Never expose provider free text. |
| Existing sensitive rows | Mark/isolate as legacy, prohibit new writes, and remove them from routine readback. Document purge, access, and verification behavior. |
| Existing clients | Preserve safe field names where feasible; use an explicit deprecation or versioning path for removed sensitive fields. Do not silently alter response semantics. |
| Durable schemas | Add forward migrations and rollback behavior that do not repopulate unsafe columns or re-enable raw writes. |
| External sinks | Define retention/deletion ownership and verification for each configured backend; new-writer protection does not remediate already-exported data. |
| Comparison capability | Preserve only as explicitly authorized; separate its storage/readback contract from ordinary telemetry and require authorization checks at every entry point. |

## Retention and Deletion Ownership

| Sink / data class | Retention | Deletion owner | Verification control |
|---|---:|---|---|
| Request logs | 30 days | Request-log storage owner | Bounded cleanup plus post-delete age/count verification |
| Usage | 30 days | Usage/cost telemetry owner | Sink-specific purge and query proving expired rows are absent |
| Analytics | 30 days | Analytics storage/export owner | Aggregate-store purge and exporter confirmation |
| Authorized comparison history | 30 days | Comparison capability owner | Authorized purge, legacy-isolation check, and readback denial check |
| Ordinary logs | 30 days | Logging/operations owner | Backend retention policy plus deletion/expiry verification |
| Traces | 30 days | Tracing/collector owner | Collector/exporter retention configuration and verification |
| Metrics | 30 days | Metrics backend owner | Backend retention configuration and expiry verification |

These durations and ownership assignments are maintainer decisions recorded for implementation planning. They are not presented as externally researched or compliance-mandated values.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/logging/`, `src/core/router-executor.ts`, `src/core/router-telemetry.ts` | Modified | Enforce bounded safe log/error projections at producer and sink boundaries. |
| `src/core/cost-tracker.ts`, `src/analytics/` | Modified | Store safe usage and aggregate metadata with retention controls. |
| `src/comparison/`, `src/server/routes/comparison.ts` | Modified | Separate explicitly authorized content history from ordinary telemetry and legacy rows. |
| `src/core/logger.ts`, `src/core/tracing.ts`, `src/core/metrics.ts` | Modified | Constrain structured fields, span attributes, and metric labels; retain redaction as defense-in-depth. |
| `src/vault/schema.ts`, `src/migrations/` | Modified | Add schema/migration and historical-data isolation or purge behavior. |
| `src/server/routes/observability.ts`, `src/server/routes/usage.ts`, MCP handlers/registry, `dashboard/` | Modified | Expose safe projections, compatibility fields, and verified access boundaries. |
| `test/` sink, HTTP, comparison, analytics, usage, and migration suites | Modified | Prove negative leakage properties, compatibility, retention, deletion, and legacy isolation. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A direct caller bypasses producer sanitization | High | Make sink interfaces typed and reject arbitrary payloads; test direct sink calls. |
| Removing sensitive fields breaks dashboards, MCP clients, or operators | High | Preserve safe compatibility projections, version/deprecate deliberately, and add consumer contract tests. |
| Historical data remains exposed after new writes are protected | High | Isolate legacy rows, disable routine readback, define purge ownership, and verify deletion. |
| External exporters retain data beyond local database controls | High | Give every exporter its own 30-day policy, owner, deletion mechanism, and verification signal. |
| Opaque IDs still permit tenant or operational correlation | Medium | Require explicit scoping/exposure decisions for every retained identifier and verify authorization at readback. |
| Comparison authorization is applied inconsistently | High | Use one explicit capability boundary for persistence and every readback path; deny by default. |

## Delivery Slicing Forecast

This change crosses producers, seven sink/data classes, durable schemas and legacy migration, exporters, HTTP/MCP readback, dashboard consumers, and tests. It likely exceeds the 400-line single-PR review budget. Task planning MUST slice the work into independently verifiable delivery units or request a maintainer `size:exception`; neither option is authorized by this proposal.

## Rollback Plan

Roll back by disabling the affected new sink contracts or capability slice and restoring the last verified safe projection, migrations, and readback route as a coordinated unit. Do not restore raw writes, routine legacy readback, provider free-text propagation, or unauthorized comparison access. If a migration cannot be safely reversed, retain the stricter schema and isolate the affected feature until a forward repair is reviewed.

## Success Criteria

- [ ] Every listed sink/exporter has a typed safe projection and rejects protected content at its boundary.
- [ ] Negative tests demonstrate that prompts, responses, credentials, arbitrary context, and provider free text do not reach unauthorized sinks or readback.
- [ ] Usage compatibility preserves safe `errorMessage` plus a safe code/category.
- [ ] Legacy sensitive rows have no new writes and no routine readback, with documented migration/purge verification.
- [ ] Comparison content is persisted/read only through the explicitly authorized capability.
- [ ] All seven sink/data classes have 30-day retention, named deletion ownership, and explicit verification controls.
- [ ] The implementation is delivered in reviewable slices; no W01/WP00 closure is claimed.

## Evidence and Research Audit

External research was explicitly revoked by the maintainer after two admissions reported empty documentation and open-web grants. The selected research remains recorded as blocked before source access; this proposal uses existing exploration evidence and confirmed product decisions only. No external evidence, compliance claim, or source-backed duration recommendation is asserted.

<!-- evidence:begin -->
- [read] The exploration identifies request logging, usage, comparison persistence, observability, usage readback, tracing, and metrics as distinct affected surfaces. src=openspec/changes/telemetry-sink-protection/exploration.md:7-22
- [read] The exploration recommends typed sink-boundary contracts with producer sanitization and requires explicit handling for legacy rows, readback, retention, and compatibility. src=openspec/changes/telemetry-sink-protection/exploration.md:41-68
- [read] The confirmed product choices require explicitly authorized comparison content, legacy isolation with no new writes or routine readback, opaque IDs, compatibility-safe usage error projection, and per-sink retention. src=openspec/changes/telemetry-sink-protection/research.md:45-55
- [read] The research audit records empty grants, denied admission, and absence of external sources or evidence-backed retention recommendations. src=openspec/changes/telemetry-sink-protection/research.md:7-22; src=openspec/changes/telemetry-sink-protection/research.md:37-43
<!-- evidence:end -->

## Next Step

Proceed to specs or design. Do not run implementation, testing, or task execution from this proposal phase.
