# Production-readiness audit

This audit records the security, architecture, reliability, delivery, and compatibility findings identified during a read-only review of `mcp-llm-bridge`. The immediate conclusion is that the product has a capable and modular functional core, but it should not be exposed as a multi-tenant gateway until tenant binding and administrative authentication are made fail-closed.

## Decision summary

| Decision | Rationale |
| --- | --- |
| Do not expose the current multi-tenant HTTP surface to untrusted tenants | Request-controlled project scope can diverge from the authenticated API-key project. |
| Do not rely on the current admin route exclusions without explicit admin credentials | Admin authentication permits access when neither `ADMIN_TOKEN` nor the global auth token exists. |
| Treat sandbox, timeout, and payload controls as incomplete | The sandbox falls back to the host, HTTP timeout does not cancel work, and body limits trust `Content-Length`. |
| Prioritize hardening over additional providers | Functional breadth and test volume already exceed the maturity of CI, packaging, lifecycle, and security gates. |

## Audit map

| Document | Read this when | Contents |
| --- | --- | --- |
| [Security and tenant isolation](security.md) | Deciding whether and how to deploy | Authentication, authorization, project scope, sandbox, plugins, temporary credentials, input limits, and request identity. |
| [Architecture and runtime reliability](architecture-runtime.md) | Planning remediation or refactoring | Runtime composition, cancellation, shutdown, routing configuration, contracts, router boundaries, and database lifecycle. |
| [Quality, delivery, and compatibility](quality-delivery-compatibility.md) | Planning CI, releases, Docker, npm, docs, or API commitments | Quality gates, tests, image reproducibility, package metadata, release drift, and API compatibility. |
| [Consolidated findings matrix](#consolidated-findings-matrix) | Prioritizing work | Every finding, severity, owner domain, and recommended phase. |

## Scope and methodology

### Scope

The review covered the TypeScript gateway, HTTP and MCP entry points, authentication and authorization, vault-facing routes, provider adapters, dynamic MCP plugins, sandbox execution, runtime startup and shutdown, model routing configuration, Zod request schemas, GitHub Actions, Docker packaging, npm metadata, dashboard tests, and public documentation.

The review did **not** include a live penetration test, cloud deployment review, dependency vulnerability scan, load test, chaos test, complete data-flow inventory, or legal/compliance certification.

### Method

1. Mapped entry points and runtime composition.
2. Traced authentication context into request scope and vault operations.
3. Reviewed trust boundaries around subprocesses, plugins, filesystem materialization, HTTP bodies, and proxy headers.
4. Compared operational controls with their actual cancellation and failure behavior.
5. Compared source capabilities with CI, container, npm, tests, changelog, and README claims.
6. Re-checked every cited source location against the current working tree before documenting it.

No executable code or configuration was modified. No claim in this report should be interpreted as proof of exploitability without runtime validation; where a conclusion is inferential, the text states the assumptions.

## Severity and priority model

| Level | Meaning | Expected response |
| --- | --- | --- |
| **P0 / Critical** | A plausible path to cross-tenant access, unauthenticated administration, or unsafe external exposure. | Block affected production exposure; remediate and test immediately. |
| **P1 / High** | A material isolation, availability, secret-handling, or operational-control weakness. | Schedule in the first hardening milestone. |
| **P2 / Medium** | Architecture or delivery debt likely to cause regressions, drift, or difficult operations. | Resolve before claiming production-grade maturity. |
| **P3 / Low** | Documentation, maintainability, or completeness gap with limited immediate impact. | Bundle with adjacent work. |

## Consolidated findings matrix

| ID | Priority | Finding | Primary evidence | Phase |
| --- | --- | --- | --- | --- |
| SEC-01 | P0 | Authenticated project is not authoritative for request scope | `src/server/http-helpers/request-scope.ts:19-30`; `src/server/routes/storage.ts:18-20,37-68,85-175` | 1 |
| SEC-02 | P0 | Administrative routes can be unauthenticated in a multi-tenant/API-key-only configuration | `src/server/http-app.ts:90-99`; `src/server/admin.ts:38-72` | 1 |
| SEC-03 | P0 | HTTP may bind externally while authentication is explicitly or implicitly disabled | `src/server/http.ts:56-77`; `src/core/config.ts:108-152`; `src/security/profiles.ts:97-123` | 1 |
| SEC-04 | P1 | Sandbox falls back to host shell execution | `src/sandbox/index.ts:105-188` | 1 |
| SEC-05 | P1 | Dynamic MCP plugins execute in the gateway process and timeouts do not terminate them | `src/mcp-builder/loader.ts:51-64,123-143`; `src/mcp-builder/adapter.ts:43-115` | 2 |
| SEC-06 | P1 | Provider home cache can collide on disk and has unsafe concurrent replacement semantics | `src/adapters/cli-home.ts:53-114` | 2 |
| SEC-07 | P1 | Request body limit is bypassable and field limits are incomplete | `src/server/http-app.ts:131-140`; `src/core/schemas.ts:11-62` | 2 |
| SEC-08 | P1 | GitHub admin OAuth is allow-all when no user allowlist exists | `src/auth/github-oauth.ts:124-127` | 1 |
| SEC-09 | P2 | Client IP and rate limiting trust a caller-controlled header in the default path | `src/server/http-app.ts:142-160,193-223` | 2 |
| SEC-10 | P2 | Caller-provided correlation IDs have no visible format or length bound | `src/server/http-app.ts:183-190` | 2 |
| SEC-11 | P1 | Vault startup does not validate or repair permissions/ownership of an existing database directory or file | `src/vault/vault.ts:94-108` | 2 |
| SEC-12 | P1 | Internal and plugin error messages are returned without a centralized sanitization boundary | `src/server/routes/observability.ts:101-102,220-232`; `src/server/mcp-dispatcher.ts:203-208`; `src/server/mcp-llm-handlers.ts:157-160` | 2 |
| RUN-01 | P1 | HTTP timeout detects lateness but does not cancel underlying work | `src/server/http-app.ts:162-181`; `src/adapters/base-cli-adapter.ts:125-143` | 2 |
| RUN-02 | P1 | Synchronous CLI execution can block the Node.js event loop | `src/adapters/cli-utils.ts:68-96`; `src/adapters/base-cli-adapter.ts:142-143` | 2 |
| RUN-03 | P1 | Shutdown does not own, stop, or drain HTTP/MCP transports | `src/bootstrap/server-startup.ts:79-113`; `src/bootstrap/shutdown.ts:30-44,71-123` | 2 |
| RUN-04 | P2 | Bundled model-routing configuration resolution is fragile and fails silently | `src/model-routing/config.ts:197-227`; `package.json:6-9` | 3 |
| ARC-01 | P2 | MCP tool declaration, dispatch, and request validation have multiple sources of truth | `src/server/mcp-tool-registry.ts`; `src/server/mcp-dispatcher.ts`; `src/server/mcp-server.ts:272-321`; `src/core/schemas.ts:11-46` | 4 |
| ARC-02 | P2 | Router remains a broad mutable orchestration object | `src/core/router.ts:159-268,318,531,699-841` | 4 |
| ARC-03 | P2 | SQLite lifecycle and ownership are fragmented across runtime services | `src/bootstrap/runtime-foundation.ts:18-30`; `src/bootstrap/core-services.ts:42-50`; `src/core/groups.ts:97-109,300-303`; `src/core/cost-tracker.ts:205-223,539-543` | 4 |
| DEL-01 | P0 | No mandatory source CI gate precedes image publication | `.github/workflows/docker.yml:29-68`; `package.json:11-18` | 3 |
| DEL-02 | P1 | Docker build is non-reproducible and tolerates missing CLIs | `Dockerfile:24-53` | 3 |
| DEL-03 | P1 | Runtime image ships the source/dev toolchain and runs through `tsx` | `Dockerfile:49-61`; `package.json:12-16` | 3 |
| DEL-04 | P2 | Test investment is broad but coverage and quality thresholds are absent | `package.json:15-17`; `.github/workflows/*.yml` | 3 |
| DEL-05 | P2 | npm package contract and release supply-chain metadata are incomplete | `package.json:1-18` | 3 |
| DOC-01 | P2 | Version, adapter count, changelog, and release claims drift from source | `package.json:3`; `README.md:27,532-540`; `CHANGELOG.md:38`; `src/core/constants.ts:36-56` | 3 |
| DOC-02 | P3 | Dashboard documentation remains generic and dashboard test depth is limited | `dashboard/README.md:1-12,16-72`; four files returned by `find dashboard/src -path '*__tests__*' -type f -print` | 3 |
| API-01 | P2 | “OpenAI-compatible” is broader than the implemented schema | `src/core/schemas.ts:28-46` | 4 |
| API-02 | P2 | Public API lacks a versioned OpenAPI contract and SDK contract tests | Absence search documented in API-02: repository files excluding `.git`/`node_modules`, matched by OpenAPI/Swagger/SDK-test/contract-test names; only `test/core/router-execution-contract.test.ts` matched and it is an internal router contract test | 4 |

## Remediation roadmap

### Phase 1 — Containment

1. Make authenticated tenant scope authoritative and reject scope mismatch.
2. Require an effective administrative credential whenever admin routes are enabled.
3. Bind HTTP to loopback by default; require an explicit, validated external-listen mode.
4. Make sandbox-required execution fail closed.
5. Make GitHub OAuth allowlists mandatory for administrative access.

### Phase 2 — Runtime hardening

1. Propagate `AbortSignal` from transports through router and adapters.
2. Replace synchronous request-path subprocess calls with cancelable async execution.
3. Enforce streaming byte limits and per-field limits.
4. Introduce concurrency limits, queue bounds, provider bulkheads, and tenant quotas.
5. Own and drain transport handles during shutdown.
6. Isolate dynamic plugins and harden temporary credential homes.
7. Normalize trusted proxy and correlation-ID behavior.

### Phase 3 — Delivery hardening

1. Add required CI for frozen install, typecheck, tests, build, and artifact smoke tests.
2. Build a minimal, non-root runtime image from `dist`, with pinned and verified CLI artifacts.
3. Add coverage thresholds, dashboard gates, container health tests, and `npm pack` smoke tests.
4. Automate SemVer, changelog, provenance, SBOM, and documentation synchronization.

### Phase 4 — Contract and architecture consolidation

1. Generate transport schemas and types from one validated contract source.
2. Introduce a canonical routing plan shared by sync and streaming paths.
3. Make runtime dependencies constructor-owned and lifecycle-explicit.
4. Publish OpenAPI and compatibility matrices; test supported behavior with official SDKs.

## Quick wins versus investments

| Quick win | Larger investment |
| --- | --- |
| Reject `X-Project`, query, or body project when it differs from `userContext.project` | Tenant-aware authorization policy applied consistently across HTTP and MCP |
| Fail startup without admin credentials in multi-tenant mode | Unified identity, roles, and policy engine |
| Set loopback as default hostname | Deployment profiles with validated exposure invariants |
| Remove host fallback from sandbox-required paths | Worker/subprocess isolation with resource controls |
| Reject OAuth admin startup without allowlist | Organization/team-aware OAuth authorization |
| Add typecheck/test/build to Docker workflow | Artifact promotion pipeline with attestations and rollback |
| Add `prepack`, `engines`, and pack smoke test | Fully reproducible multi-platform release process |
| Document the actual compatibility subset | Generated OpenAPI plus SDK conformance suite |

## Existing strengths

The findings should not obscure the substantial foundation already present: modular bootstrap files, typed adapters, routing aliases/groups/fallbacks, circuit breakers, transformer and telemetry components, AES-256-GCM vault encryption, parameterized SQLite usage, Prometheus/Pino/OpenTelemetry integration, plugin collision detection and quarantine bookkeeping, and a large backend test corpus. These controls reduce remediation cost, but they do not compensate for fail-open trust boundaries.

## Audit limitations

- This was a static, read-only assessment; the complete test suite was not used as evidence of a green build.
- No exploit was executed against tenant, admin, plugin, sandbox, or proxy behavior.
- Deployment-specific controls in an external reverse proxy, orchestrator, firewall, or secret manager were not assessed.
- Dependency advisories and transitive license risks were not scanned.
- Performance and race conclusions require targeted concurrency and load tests for confirmation.
- Line references describe the reviewed working tree and may move as the code changes.

