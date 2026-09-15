## Exploration: telemetry-sink-protection

### Current State

The repository already contains a metadata-only SAFE-CORE telemetry helper, but the broader telemetry surface still has several independent producers, durable stores, exporters, and readback APIs. This change must protect those real sinks without claiming that the separate SAFE-CORE/WP-01 work is complete.

<!-- evidence:begin -->
- [read] SAFE-CORE telemetry has a closed shape containing only event, operation, outcome, optional code, and duration; its documented exclusions include prompt, response, credential, error, and context. src=src/core/safe-telemetry.ts:4-24
- [read] Request logging accepts error text plus arbitrary request and response data, serializes or truncates those values, and inserts them into request_logs. src=src/logging/request-logger.ts:14-29
- [read] RequestLogger.captureEnd persists error.message and serialized request/response data, while its public query projection omits request_data and response_data but still returns error. src=src/logging/request-logger.ts:147-168
- [read] RequestLogger has an explicit age-based cleanup operation for request_logs. src=src/logging/request-logger.ts:401-419
- [read] CostTracker persists provider, model, project, user identity, usage, success, and errorMessage fields in usage_logs; raw query results include errorMessage. src=src/core/cost-tracker.ts:23-56
- [read] Provider execution catches convert unknown failures to Error.message, record that message as usage telemetry, and log it through the logger. src=src/core/router-executor.ts:193-205
- [read] Comparison persistence stores prompt, system prompt, models, full results, summary, and project as durable JSON/text fields and writes those values on save. src=src/comparison/persistence.ts:12-22; src=src/comparison/persistence.ts:59-87
- [read] Comparison HTTP responses intentionally return the prompt and each result.response, and history returns the same projection. src=src/server/routes/comparison.ts:13-47
- [read] The database initializer creates usage_logs with error_message and comparison_results with prompt, system_prompt, results, and summary columns. src=src/vault/schema.ts:111-134
- [read] Pino redaction covers common sensitive keys including prompt, response, content, err, and error, but this is key-path redaction rather than a typed contract for every producer. src=src/core/logger.ts:25-57
- [read] OpenTelemetry enables HTTP and Pino instrumentation. src=src/core/tracing.ts:41-51
- [read] The tracing module's error-span helper records an exception and error.message, and its generation-span helper exports provider/model/project attributes. src=src/core/tracing.ts:69-103
- [read] Prometheus metrics use provider, model, method, path, and status labels; HTTP middleware passes normalizeMetricsPath, which normalizes only a limited allowlist and otherwise returns the original path. src=src/core/metrics.ts:27-59; src=src/server/http-helpers/metrics-path.ts:1-18
- [read] Observability routes expose logs, metrics, and analytics through HTTP handlers; the usage routes expose raw usage records and summaries. src=src/server/routes/observability.ts:70-226; src=src/server/routes/usage.ts:6-78
- [read] The observability and usage route files do not establish authentication or tenant authorization themselves. src=src/server/routes/observability.ts:70-112; src=src/server/routes/usage.ts:6-15
<!-- evidence:end -->

The principal compatibility boundary is not uniform. `/v1/logs` currently returns a reduced log projection, while usage records include an error-message field and comparison endpoints expose prompts and model responses. Existing durable rows may already be accessible to operators or downstream consumers, so a fix must distinguish new-write guarantees from historical-data remediation. Effective authentication and project isolation require verification in the surrounding middleware before proposal finalization.

Retention is incomplete as a documented design: request logs have a cleanup primitive, but this exploration did not verify equivalent retention or deletion behavior for usage, analytics, or comparison data. Migration work must therefore define retention and historical-row handling rather than assuming that truncation or a new writer protects data already stored.

### Affected Areas

- `src/core/safe-telemetry.ts` — reuse or align the existing closed metadata contract without expanding SAFE-CORE scope.
- `src/core/router-executor.ts`, `src/core/router.ts`, `src/core/router-telemetry.ts` — normalize provider failures and telemetry labels before logs, usage records, or metrics receive them.
- `src/logging/request-logger.ts`, `src/logging/types.ts`, `src/logging/schemas.ts` — remove or constrain arbitrary error/request/response persistence while preserving the intentional public log contract.
- `src/core/cost-tracker.ts`, `src/vault/schema.ts`, `src/migrations/001_request_logs.sql`, `src/migrations/002_analytics.sql`, `src/migrations/007_comparison.sql`, and later compatibility migrations — change durable schemas/writers and define migration/backfill/rollback behavior.
- `src/comparison/persistence.ts`, `src/comparison/service.ts`, `src/server/routes/comparison.ts` — decide whether prompt and model-response persistence/readback is removed, redacted, opt-in, or moved behind a separate explicitly authorized feature.
- `src/analytics/aggregator.ts`, `src/analytics/sqlite-writer.ts`, `src/analytics/sqlite-reader.ts`, `src/server/routes/observability.ts` — keep aggregate observability metadata-only and establish retention/readback boundaries.
- `src/core/logger.ts`, `src/core/tracing.ts`, `src/core/metrics.ts`, `src/server/http-helpers/metrics-path.ts` — enforce safe structured fields, span attributes, and bounded metric labels; redaction should remain defense-in-depth, not the only boundary.
- `src/server/routes/usage.ts`, `src/server/mcp-tool-handlers.ts`, `src/server/mcp-tool-registry.ts`, `src/server/routes/admin/dashboard.ts`, and `dashboard/src/` — update readback contracts and tenant/project scoping if sensitive fields are removed or renamed.
- Existing tests under `test/logging/`, `test/http-logs.test.ts`, `test/cost-tracker.test.ts`, `test/core/router-telemetry.test.ts`, `test/http-analytics.test.ts`, `test/http-comparison.test.ts`, and `test/migrations/` — add negative assertions proving sensitive values cannot reach each sink and compatibility assertions for safe projections.

### Approaches

1. **Typed sink-boundary contracts (recommended)** — define safe event/error/usage projections and require each durable writer, logger, tracer, metric, and readback adapter to accept only those projections; migrate or retire incompatible raw columns and APIs.
   - Pros: fail-closed at the actual sinks; new producers cannot silently reintroduce arbitrary payloads; makes API and migration effects explicit.
   - Cons: cross-cutting change; requires decisions for existing comparison history and usage error consumers; likely needs schema migrations and coordinated dashboard/MCP updates.
   - Effort: High

2. **Producer-only sanitization** — keep sink schemas and interfaces, but sanitize values at each current producer before calling the existing logging, usage, comparison, tracing, and metrics code.
   - Pros: smaller initial diff; lower immediate API and migration disruption.
   - Cons: direct callers and future producers can bypass the rule; arbitrary request/response fields remain available; historical rows and readback contracts stay unsafe; difficult to prove complete coverage.
   - Effort: Medium

3. **Disable or delete raw telemetry features** — turn off request/response persistence and comparison history, and retain only aggregate operational metrics and stable error codes.
   - Pros: strongest reduction in exposure and simplest long-term invariant.
   - Cons: breaks existing observability/comparison workflows and consumers; requires explicit product approval and a migration/retention plan for existing data.
   - Effort: Medium

### Recommendation

Use **typed sink-boundary contracts** as the implementation approach, with producer sanitization as an additional defense. The proposal should make the following invariants testable:

- No prompt, system prompt, response, credential, authorization material, arbitrary context, or free-form provider error message reaches durable telemetry, ordinary logs, traces, or metric labels.
- Operational records retain only bounded metadata and stable error codes/categories; project, user, API-key, provider, model, route, and correlation identifiers require an explicit exposure/scoping policy rather than being assumed safe.
- Readback APIs and MCP/dashboard consumers expose only the safe projection and enforce the repository's actual authorization/project boundary.
- Every durable telemetry table has an explicit retention/deletion policy, and the migration plan states whether historical sensitive rows are scrubbed, purged, isolated as legacy data, or accepted as already public/irreversible.
- Existing consumers receive a deliberate compatibility path: versioned fields, a deprecation window, or an explicit breaking change. Do not silently change response semantics.

The likely implementation exceeds the default review budget because it crosses producers, four durable domains, exporters, HTTP/MCP readbacks, migrations, and tests. It should be decomposed into independently verifiable slices unless the orchestrator explicitly accepts a size exception.

Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High

Open decisions for the orchestrator/product owner are: whether comparison prompt/response history remains a supported feature; whether historical raw rows are purgeable; which identity fields may be retained and exposed; what retention periods apply per table/exporter; and whether removing usage error text is a breaking API change or receives a compatibility projection.

### Risks

- Sanitizing only at current producers leaves direct `RequestLogger`, `CostTracker`, comparison, or exporter callers as bypasses.
- Removing raw fields can break dashboard, MCP, API, or operator tooling even when the current route code appears internal.
- Migration backfills cannot reliably reconstruct sensitive-free values from arbitrary JSON; purge or legacy isolation may be safer than lossy rewriting.
- Historical SQLite rows and external log/trace/metrics backends are outside the new-writer boundary and need an explicit remediation/retention decision.
- Project, user, API-key, route, model, and correlation identifiers can still leak tenant or operational context even when prompts and responses are removed.
- The current tracing and Pino integrations are defense-in-depth only; relying on redaction configuration without typed sink contracts risks future fields bypassing the configured paths.

### Ready for Proposal

No. The codebase exploration is sufficient to draft a proposal, but the orchestrator should first resolve the five product decisions listed above, especially whether comparison history and historical raw data are intentionally retained. After those decisions, proceed to `sdd-propose` with the typed-boundary approach and a chained-PR forecast.
