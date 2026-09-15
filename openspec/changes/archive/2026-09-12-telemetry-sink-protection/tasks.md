# Tasks: Telemetry Sink Protection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,050–1,350 lines across 5 slices |
| 400-line risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts; PR 2 storage; PR 3 sinks; PR 4 comparison; PR 5 readback |
| Delivery strategy | ask-on-risk (default) |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Typed projections and failures | PR 1 | `pnpm exec node --import tsx --import ./test/setup/inject-require.mjs --test test/logging/request-logger.test.ts test/core/router-telemetry.test.ts test/cost-tracker.test.ts` | N/A: pure contracts | Revert new contracts; retain redaction |
| 2 | Protected tables and legacy isolation | PR 2 | `pnpm exec node --import tsx --test test/vault/schema.test.ts test/migrations/telemetry-sink-protection.test.ts` | Disposable SQLite | Revert only if guards remain; otherwise retain strict schema |
| 3 | Six sinks plus retention/export proof | PR 3 | `pnpm exec node --import tsx --test test/logging/request-logger.test.ts test/analytics/sqlite-writer.test.ts test/core/telemetry-sinks.test.ts` | N/A: backend fakes | Disable exporter; never restore raw writes |
| 4 | Authorized comparison boundary | PR 4 | `pnpm exec node --import tsx --test test/comparison/persistence.test.ts test/comparison/service.test.ts test/comparison/retention.test.ts` | Isolated SQLite comparison flow | Disable capability; preserve legacy isolation |
| 5 | Readback, compatibility, dashboard | PR 5 | `pnpm exec node --import tsx --test test/server/routes/usage.test.ts test/server/routes/observability.test.ts test/http.test.ts test/dashboard-readback.test.ts` | HTTP/MCP scope harness | Revert v2 consumers; retain safe v1 deprecation |

## Phase 1: Contracts and Foundation

- [x] 1.1 **RED** Add plain/nested/renamed/Base64/escaped/Unicode/truncation canaries to `test/logging/request-logger.test.ts`, `test/core/router-telemetry.test.ts`, and `test/cost-tracker.test.ts`; assert pre-side-effect rejection and bounded failures.
- [x] 1.2 **GREEN** Create `src/core/telemetry-contracts.ts` and `src/core/telemetry-failure.ts`; wire closed projections into `src/logging/schemas.ts`, `src/core/router-telemetry.ts`, and `src/core/cost-tracker.ts`. Depends on 1.1; no SAFE-CORE/W01/WP00.

## Phase 2: Storage and Migration

- [x] 2.1 **RED** Add forward/rollback gate tests in `test/migrations/telemetry-sink-protection.test.ts` and `test/vault/schema.test.ts` for four gates, incomplete evidence, and legacy isolation.
- [x] 2.2 **GREEN** Add `src/migrations/012_storage_legacy_isolation.sql`, `src/migrations/012_storage_legacy_isolation_rollback.sql`, and update `src/vault/schema.ts` to isolate legacy tables, reject raw writes, and expose protected storage. Depends on 1.2 and 2.1.

## Phase 3: Sink Writers, Exporters, and Retention

- [x] 3.1 **RED** Extend `test/core/telemetry-sinks.test.ts`, `test/analytics/sqlite-writer.test.ts`, and `test/logging/request-logger.test.ts` with negative canaries, seven independent 30-day outcomes, and exporter receipt/absence tests.
- [x] 3.2 **GREEN** Update `src/logging/request-logger.ts`, `src/analytics/sqlite-writer.ts`, `src/analytics/sqlite-reader.ts`, `src/analytics/aggregator.ts`, `src/core/logger.ts`, `src/core/tracing.ts`, and `src/core/metrics.ts`; add `src/telemetry/retention.ts` and exporter verification. Depends on 2.2 and 3.1.

## Phase 4: Comparison Capability

- [x] 4.1 **RED** Add `test/comparison/retention.test.ts` and extend `test/comparison/service.test.ts`/`test/comparison/persistence.test.ts` for capability+scope, legacy denial, content-free audit, purge, and sink isolation.
- [x] 4.2 **GREEN** Update `src/comparison/service.ts`, `src/comparison/persistence.ts`, `src/comparison/schemas.ts`, `src/server/routes/comparison.ts`, and `src/security/enforcer.ts` to guard every persistence/readback/export entry point. Depends on 2.2 and 4.1.

## Phase 5: Readback and Compatibility Verification

- [x] 5.1 **RED** Add channel×operation tests in `test/server/routes/usage.test.ts`, `test/server/routes/observability.test.ts`, `test/http.test.ts`, and `test/dashboard-readback.test.ts`; cover v1/v2 fields, scope denial, ID equivalence, and MCP deprecation.
- [x] 5.2 **GREEN** Update `src/server/routes/usage.ts`, `src/server/routes/observability.ts`, `src/server/mcp-tool-registry.ts`, `src/server/mcp-tool-handlers.ts`, `dashboard/src/api/types.ts`, `dashboard/src/api/client.ts`, `dashboard/src/pages/Usage.tsx`, and `dashboard/src/pages/Overview.tsx`; add gate evaluators and provenance status. Depends on 3.2 and 4.2.
