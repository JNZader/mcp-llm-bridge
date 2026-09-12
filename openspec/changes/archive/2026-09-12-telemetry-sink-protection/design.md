# Design: Telemetry Sink Protection

## Technical Approach

Use strict sink schemas and flat TypeScript interfaces. Writers/exporters parse `unknown` before side effects; readers select safe projections. Migration isolates legacy rows before later slices.

## Architecture Decisions

| Decision | Rejected; rationale |
|---|---|
| Strict sink projections | Producer redaction; direct callers/excess fields bypass it. |
| Const-backed safe failure code/category/text | Truncated errors; truncation cannot sanitize provider text. |
| Protected tables/views; migration-only legacy handles | Lossy rewrite; historical text/JSON is unprovable. |
| Comparison capability at route/service/store | Broad categories; each persistence/read/export needs scoped authorization. |

## Exposure Decisions

Record IDs are random, opaque, and exposed only for authorized in-scope lookup/deletion. User/API-key/key-name/project keys remain internal and opaque; project derives from `UserContext`. Provider/model IDs are registry-bounded; routes are normalized templates. Correlation/channel is internal-only. All other identity, raw path/query, and routine/external exposure is denied.

## Legacy Isolation and Data Flow

Migration renames raw request/usage/comparison tables as migration-only legacy storage and redirects routine repositories to protected tables/views. Guards cover every path enumerated in the acceptance matrix. Known legacy-ID lookup matches nonexistent-ID denial.

```text
input/error -> normalize -> strict projection -> protected sink
caller -> capability + authenticated scope -> safe projector -> consumer
legacy handle -> migration/deletion only (all routine paths deny)
```

## External Retention Ownership

Each external backend registers distinct deletion/policy owners and a 30-day verifier before export.

| Backend | Distinct owners | Proof |
|---|---|---|
| Pino | Logging deletion/policy operators | Expiry/delete receipt+absence |
| OTLP | Trace deletion/policy operators | Collector+backend confirmation |
| Prometheus | Metrics deletion/policy operators | Remote expiry+age/series absence |
| Analytics exporter | Analytics deletion/policy operators | Deletion receipt+absence |

Missing control/owner or failed/indeterminate proof disables export. Local success never implies external success.

## Consumer Compatibility

Publish safe v2 HTTP/MCP/adapter/dashboard schemas. Keep v1 for one release as deprecated safe adapters: names retain safe semantics; `usage.errorMessage` is bounded text beside safe code/category; `requestData`, `responseData`, raw `error`, `keyName`, `userId`, `project`, and `correlationId` stay absent. HTTP emits `Deprecation`/`Sunset`/successor `Link`; MCP marks schemas deprecated. Dashboard migrates first; remove v1 after sunset.

## File Changes

| Paths | Change |
|---|---|
| `src/logging/*`, `src/core/{router-telemetry,cost-tracker,logger,tracing,metrics}.ts`, `src/analytics/*` | Contracts, safe failures/queries, retention. |
| `src/comparison/*`, `src/server/routes/{comparison,observability,usage}.ts`, `src/security/*` | Scoped comparison/readback guards. |
| `src/vault/schema.ts`, `src/migrations/012_telemetry_sink_protection*.sql` | Protected storage, isolation, gates. |
| `src/server/mcp-*`, `dashboard/src/api/*`, admin/dashboard consumers | Versioned projections. |

## Acceptance Tests

Classes: **P** prompt/system-prompt/response; **C** credential/authorization; **X** arbitrary-context/provider-free-text; **O** opaque IDs; **M** bounded allowed metadata. **D** rejects before side effects and excludes durable/emitted/read/exported values. **A** permits only current comparison P/summaries with explicit capability+scope; C/X remain D. O/M default to D unless declared. **R** means capability+scope safe projection with legacy and known-ID indistinguishable from nonexistent. **E** means the external policy below.

Every row tests plain, nested, renamed, Base64, URL/JSON-escaped, Unicode, and truncation-boundary canaries.

| Scope | P/C/X | O/M outcome | Access/export outcome | Required evidence/tests |
|---|---|---|---|---|
| Request logs | D | Declared projection | R | Writer canaries; `getLogs` list/filter/count; gates; age/count absence |
| Usage | D | Usage/cost+safe failure projection | R: query/summary/breakdown/admission/oldest | Writer/error canaries; all reads; gates; row absence |
| Analytics | D | Declared aggregates | R: live/durable/merge/aggregate/export; E | Writer/read/export canaries; gates; aggregate/export absence |
| Authorized comparison history | A | Scoped record O/M | Comparison-only persist/list/detail/search/export; all other/legacy access denies without existence disclosure | Per-entry round-trip/denial; isolation canaries; content-free audit; gates; ID/read denial |
| Ordinary logs | D | Declared O/M | R; E | Capture/readback canaries; gates; backend receipt+absence |
| Traces | D | Declared O/M | R; E | Attribute/export canaries; gates; collector+backend proof |
| Metrics | D | Declared O/M | R; E | Label/export canaries; gates; age/series absence |
| Dashboard/admin/HTTP/MCP/adapter readbacks | D | Source projection | R; comparison only through its boundary | Every channel×list/filter/search/detail/aggregate/export; v1/v2 compatibility |
| External exporters | D | Declared O/M | Deny unsupported or owner/control/verifier missing; local≠external success | Outbound canaries; backend eligibility/receipt/absence/failure/indeterminacy |
| Readback scope failures | D | None | Missing, invalid, or indeterminate scope fails closed with one normalized safe error and zero record-existence disclosure | Each scope state × every readback channel/operation; known/nonexistent record equivalence |
| Comparison summaries (protected) | A only at comparison boundary; otherwise D | Scoped summary O/M only | Persist/read/export requires explicit comparison capability+scope | Allowed/denied summary tests with renamed, encoded, nested, and truncation-boundary canaries |
| Migration/rollback gate evidence | D | None | Forward and rollback outcomes are independently gated | Separate forward and rollback evidence/tests for `RAW_WRITE_REJECTION`, `ROUTINE_READBACK_DENIAL`, `AUTHORIZED_COMPARISON_BEHAVIOR`, and `LEGACY_ISOLATION` |
| Seven-sink retention negatives | D | None | Request logs, usage, analytics, comparison history, ordinary logs, traces, and metrics: `FAILED`, `INDETERMINATE`, or `NOT_VERIFIED` never reports success | Per-sink × each negative outcome verification tests; assert no success |

For forward **and** rollback, `RAW_WRITE_REJECTION`, `ROUTINE_READBACK_DENIAL`, `AUTHORIZED_COMPARISON_BEHAVIOR`, and `LEGACY_ISOLATION` independently report `VERIFIED`, `FAILED`, or `INDETERMINATE`; missing evidence yields `NOT_VERIFIED`. Retention/deletion reports success only on sink-specific 30-day absence evidence; otherwise `FAILED`, `INDETERMINATE`, or `NOT_VERIFIED`. No protected content may enter evidence.

## Migration / Rollout

Completion requires all four gates `VERIFIED`; any other result keeps affected capabilities isolated and blocks later slices. Slice 0 installs isolation, raw-write rejection, safe adapters, and forward/rollback evaluators. Rollback retains stricter schemas and guards.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable classification, or process-routing boundary is introduced.

## Scope and Open Questions

No SAFE-CORE/W01/WP00 closure, size exception, external research, or compliance claim. The 30-day policy is maintainer-selected. Open questions: none.
