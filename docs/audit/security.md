# Security and tenant-isolation findings

The deployment-blocking issue is a mismatch between authenticated identity and effective project scope. Administrative authentication and network exposure also fail open in configurations that are plausible during multi-tenant rollout.

## SEC-01 — Authenticated project is not authoritative

**Priority:** P0 / Critical  
**Affected boundary:** API key → project → vault/provider credentials

### Evidence

- `resolveRequestScope()` reads `userContext`, but chooses `project` with `resolveRequestProject(bodyProject, context)` rather than `userContext.project`: `src/server/http-helpers/request-scope.ts:19-30`.
- `resolveRequestProject()` returns the body project or `X-Project`: `src/server/http-helpers/request-validation.ts:70-78`.
- Storage routes separately accept project from query/header and pass it to vault list/delete operations: `src/server/routes/storage.ts:18-20,85-103,157-175`.
- Credential and file creation accept project from validated body/header: `src/server/routes/storage.ts:37-68,111-139`.

### Impact and scenario

Assuming an API key is intended to be project-scoped, a caller authenticated for project A can submit project B in a body, header, or query parameter. The route then asks the vault to operate in B's scope. Depending on vault method behavior and route coverage, this can enable metadata disclosure, use of another tenant's credentials for inference, or modification/deletion of another tenant's resources.

### Existing controls

- API-key middleware creates a `UserContext`.
- Vault methods accept project arguments, and delete errors distinguish unauthorized/not-found outcomes.
- Inputs are parsed through Zod on create routes.

These controls do not bind the requested project to the authenticated project.

### Required remediation

1. Resolve identity exactly once in authentication middleware.
2. If the identity is project-scoped, set effective project only from `userContext.project`.
3. Reject conflicting body, header, or query project with a stable 403 error.
4. Reserve `_global` and cross-project operations for an explicit administrator role.
5. Pass effective tenant and effective trust level as a non-optional request context.
6. Test every storage, usage, metadata, model, chat, messages, and generation route with A→A, A→B, A→global, admin→B, and missing-scope cases.

### Acceptance criteria

- A project-scoped key cannot observe whether another project exists.
- No route derives authorization scope directly from caller input.
- Audit logs record authenticated subject, requested scope, effective scope, and denial reason without recording secrets.

## SEC-02 — Administrative routes can become public

**Priority:** P0 / Critical

### Evidence

- Global bearer authentication skips `/v1/admin/*`: `src/server/http-app.ts:90-99`.
- `adminAuth()` accepts GitHub JWT or a static token, but calls `next()` when neither `ADMIN_TOKEN` nor `config.authToken` exists: `src/server/admin.ts:38-72`.

### Impact and scenario

An installation can enable multi-tenant API keys while omitting the global auth token. Because admin routes are excluded from global bearer auth and their local middleware disables authentication without a configured admin/global token, administrative operations may be reachable without credentials. Impact can include API-key lifecycle changes, operational reconfiguration, and access to administrative data.

### Existing controls

- Static tokens are compared through `tokenEquals` when configured.
- GitHub dashboard JWTs can authenticate.
- CORS preflight is intentionally exempt.

### Required remediation

- Fail startup if admin routes are enabled without at least one validated admin authentication mechanism.
- Keep `/v1/admin/auth-config` public only if its response is explicitly non-sensitive and tested.
- Separate `AdminPrincipal` from ordinary API-key identity.
- Require strong `ADMIN_TOKEN` or OAuth with mandatory allowlist/organization policy.
- Add configuration-matrix tests covering production/development, multi-tenant on/off, global token present/absent, admin token present/absent, and OAuth configured/misconfigured.

## SEC-03 — Unsafe network exposure is easy to configure

**Priority:** P0 / Critical

### Evidence

- `serve()` receives a port but no hostname: `src/server/http.ts:56-77`.
- Authentication is optional outside production and can be explicitly disabled in production: `src/core/config.ts:108-138`.
- The default security profile is `local-dev`; it permits destructive, read, generate, and admin categories with no rate limit: `src/core/config.ts:140-152`; `src/security/profiles.ts:97-110`.

### Impact and scenario

Actual bind behavior depends on the Node/Hono server default. If it listens on non-loopback interfaces, a development or explicitly auth-disabled process can expose broad gateway capabilities to the local network or container network. The combination, rather than any one setting, is the risk.

### Required remediation

- Add `LLM_GATEWAY_HOST`, defaulting to `127.0.0.1`.
- Require an explicit external-listen flag for non-loopback hosts.
- Validate the invariant: external host implies authentication, restricted profile, bounded rate limiting, and secure admin auth.
- Log the effective scheme/host/port/auth/profile at startup without secrets.
- Test fail-closed configuration combinations.

## SEC-04 — Sandbox falls back to host execution

**Priority:** P1 / High

### Evidence

`executeInSandbox()` checks Docker and, when unavailable, executes `sh -c` on the host, returning `sandboxed: false`: `src/sandbox/index.ts:105-188`. Docker execution itself also places the command behind `sh -c`: `src/sandbox/index.ts:90-100`.

### Impact and scenario

A transient Docker outage or deployment without Docker silently changes a requested isolated operation into host execution. Any injection or overly broad command capability then has host privileges and filesystem/network reach of the gateway process.

### Existing controls

Docker arguments include working-directory and tmpfs controls, and both paths have timeouts and output-buffer limits. The result reports whether execution was sandboxed, but only after execution.

### Required remediation

- Introduce an explicit policy: `required`, `preferred`, or `disabled`; production defaults to `required`.
- When required and unavailable, return a typed dependency-unavailable error without executing.
- Prefer executable plus argv over shell command strings.
- Run containers as a non-root UID with read-only root filesystem, dropped capabilities, `no-new-privileges`, seccomp/AppArmor, PID/memory/CPU limits, and controlled networking.
- Emit metrics and alerts for sandbox unavailability and rejected execution.

## SEC-05 — Dynamic plugins share gateway privileges

**Priority:** P1 / High

### Evidence

- Plugin files are copied and dynamically imported in-process: `src/mcp-builder/loader.ts:123-143`.
- Import and invocation timeouts use `Promise.race`: `src/mcp-builder/loader.ts:51-64`; `src/mcp-builder/adapter.ts:43-115`.
- Registration validates top-level shape and tool security metadata and includes collision/quarantine handling, but JavaScript top-level code runs during import.

### Impact and scenario

A malicious or compromised plugin can read process environment, vault-accessible filesystem state, network resources, and application memory. A timed-out import or invocation can continue executing because rejecting the waiting promise does not terminate JavaScript execution.

### Existing controls

Filename filtering, copied shadow modules, shape validation, mandatory security metadata, name-collision detection, failure counters, and quarantine improve admission and observability. They are not a security boundary.

### Required remediation

- Run plugins in dedicated worker threads or subprocesses with a narrow RPC contract; prefer subprocesses where termination and OS policy are required.
- Kill the execution unit on deadline and recreate it after termination.
- Validate plugin directory ownership, mode, regular-file status, and symlink behavior.
- Add content hashes/signatures and an explicit allowlist of admitted plugins.
- Minimize environment variables, filesystem mounts, network access, and available methods.

## SEC-06 — Temporary provider homes can collide and race

**Priority:** P1 / High

### Evidence

`materializeProviderHome()` uses a cache key containing provider and project, but constructs the physical path only from sanitized provider and an eight-character file hash: `src/adapters/cli-home.ts:53-100`. On a changed cache entry it recursively deletes the previous directory; cleanup also deletes the shared physical path: `src/adapters/cli-home.ts:75-81,102-114`.

### Impact and scenario

Two tenants with identical provider files produce different in-memory cache keys but the same on-disk path. Concurrent requests can share credentials or one request can remove/replace the directory while another CLI is using it. The eight-character suffix also increases accidental collision risk relative to a cryptographic unique directory.

### Existing controls

Provider names and file names are sanitized; directories/files use `0700`/`0600`; project participates in the in-memory cache key.

### Required remediation

- Use `mkdtemp` beneath a mode-`0700` root and include a non-secret tenant identifier in directory ownership metadata.
- Use a cryptographic content digest only for cache validation, not as the sole directory identity.
- Add leases/reference counts so replacement and cleanup wait for active consumers.
- Validate root ownership and reject symlinks before writing.
- Add concurrent same-tenant and cross-tenant tests, including identical file content.

## SEC-07 — Body and field limits are incomplete

**Priority:** P1 / High

### Evidence

- Middleware rejects only when declared `Content-Length` exceeds `MAX_BODY_SIZE`: `src/server/http-app.ts:131-140`.
- `prompt` has a maximum, while `context`, `instruction`, `system`, message content, credential keys, stored file content, and arrays do not show equivalent limits: `src/core/schemas.ts:11-62`.

### Impact and scenario

Chunked requests or requests without `Content-Length` can be parsed fully by `c.req.json()`, consuming memory. Individually unbounded fields and arrays can also bypass prompt-specific limits, amplify provider cost, or store oversized secrets/files.

### Required remediation

- Count bytes while reading and terminate above the aggregate limit regardless of transfer encoding.
- Apply per-field, per-array, per-message, and aggregate semantic limits.
- Set tenant quotas for stored bytes, requests, tokens, concurrency, and daily cost.
- Return stable 413/422 error contracts and metrics without echoing sensitive input.

## SEC-08 — GitHub OAuth allowlist defaults to allow-all

**Priority:** P1 / High

`isUserAllowed()` returns true when `GITHUB_ALLOWED_USERS` is absent: `src/auth/github-oauth.ts:124-127`. For an administrative dashboard, a valid GitHub identity is authentication, not sufficient authorization.

Require a non-empty user, organization, or team policy before enabling OAuth admin login. Fail startup on an incomplete OAuth configuration and log only the policy mode/count, never identities or tokens.

## SEC-09 — Default client IP is caller-controlled

**Priority:** P2 / Medium

When no trusted-proxy set is configured, `getClientIp()` uses `x-real-ip`: `src/server/http-app.ts:142-160`. Rate limiting keys directly on that value: `src/server/http-app.ts:193-223`. A direct client can rotate/spoof the header and dilute limits.

Use the socket peer address as the default. Only process forwarding headers when the immediate peer belongs to an explicitly configured trusted proxy chain, and parse the chain according to deployment topology.

## SEC-10 — Correlation IDs accept unbounded caller input

**Priority:** P2 / Medium

The middleware reuses `X-Correlation-ID` without visible validation: `src/server/http-app.ts:183-190`. Oversized or control-character values can increase log volume or disrupt downstream telemetry formats.

Accept a conservative character set and length, otherwise generate a UUID. Preserve an external request ID in a separately sanitized field if interoperability requires it.

## SEC-11 — Existing vault paths are not permission- or ownership-validated

**Priority:** P1 / High

### Evidence

- The vault constructor creates the parent directory with mode `0700` only when the directory does not already exist: `src/vault/vault.ts:94-101`.
- It then opens `config.dbPath` directly and initializes the database, without a visible `lstat`/`stat`, ownership check, symlink rejection, `chmod`, or database-file mode check in that startup path: `src/vault/vault.ts:103-108`.
- The database handle is exposed to other runtime components through `getDb()`: `src/vault/vault.ts:88-92`.

This is a static finding about the reviewed constructor path, not proof that a deployed file is currently readable by another user. Effective exposure depends on the pre-existing directory/file modes, owner, umask, mount, container user, and host policy. The important gap is that startup does not establish or verify the invariant it relies on when the path already exists.

### Impact and scenario

A database restored, pre-created, or mounted with permissive modes or unexpected ownership can be accepted unchanged. Because the vault database contains encrypted credential material and operational metadata, unintended local readers can obtain ciphertext and metadata; an unintended writer can corrupt or replace the database. A symlink or ownership mismatch also makes the effective storage target less trustworthy than configuration implies.

### Required remediation

- Resolve and validate the parent and database path before opening them; reject symlinks and unexpected file types.
- Require the configured service UID/GID to own the path, or document and validate an explicit shared-ownership policy.
- Enforce restrictive directory and file modes after creation and on every startup; fail closed when they cannot be repaired safely.
- Apply equivalent checks to WAL/SHM sidecars and backup/restore paths.
- Add startup tests for fresh, permissive, wrong-owner, symlinked, read-only, and restored paths.

## SEC-12 — Internal and plugin errors lack a centralized sanitization boundary

**Priority:** P1 / High

### Evidence

- Several HTTP 500 handlers serialize `Error.message` directly, for example observability routes at `src/server/routes/observability.ts:101-102,220-232`.
- The MCP dispatcher serializes a caught exception message into the tool result: `src/server/mcp-dispatcher.ts:203-208`.
- An MCP LLM handler likewise returns the caught message directly: `src/server/mcp-llm-handlers.ts:157-160`.
- The generic MCP helper `errorResult()` accepts an arbitrary message and returns it as an error result without classification or redaction: `src/mcp-builder/index.ts:383-388`.

The evidence establishes repeated direct propagation paths. It does not assert that every possible message contains a secret, nor that no individual caller sanitizes before throwing. The architectural finding is the absence of a single, enforceable response boundary that maps internal/plugin exceptions to stable public errors while retaining full diagnostics only in protected logs.

### Impact and scenario

Provider SDKs, subprocesses, database libraries, and third-party plugins can place filesystem paths, upstream response fragments, identifiers, configuration details, or credential-adjacent data in exception messages. Directly returning those strings makes disclosure depend on every throw site behaving safely.

### Required remediation

- Introduce one HTTP/MCP error mapper with typed public codes and generic messages for unclassified failures.
- Keep original exception details in structured server logs correlated by a generated incident/request ID; apply secret redaction there as well.
- Treat plugin and provider errors as untrusted input and bound their length before logging or returning them.
- Permit detailed validation errors only from explicitly classified, field-safe validation types.
- Add tests that inject secrets, paths, upstream bodies, control characters, and oversized messages through HTTP and dynamic MCP failures and assert that public responses are sanitized.

## Security verification checklist

- [ ] Cross-tenant negative tests cover every project-aware route and MCP tool.
- [ ] Multi-tenant/admin configuration matrix fails closed.
- [ ] External binding cannot start with auth disabled or `local-dev` profile.
- [ ] Docker loss never causes host execution for sandbox-required work.
- [ ] Plugin timeout terminates the execution unit.
- [ ] Temporary-home concurrency tests prove no cross-project sharing or deletion race.
- [ ] Chunked oversized bodies are rejected before JSON materialization.
- [ ] Proxy and correlation headers are fuzz-tested.
- [ ] Existing vault directories, database files, and SQLite sidecars are ownership/mode/symlink validated.
- [ ] HTTP and MCP failures pass through one tested sanitizer and never echo injected secrets.

