# Remediation status

Tracks what was applied against the audit findings, what remains, and what was
deliberately skipped. Calibrated to the **actual threat model**: local use +
a self-controlled VPS running the owner's own apps, **no untrusted third-party
tenants**. Findings that only matter under multi-tenant / untrusted exposure are
skipped on purpose, not forgotten.

All 26 audit findings were independently verified against the current source
before any action: every `file:line` reference matched, zero false positives.

## Verification method

- Static verification of each finding's cited code against the working tree.
- `pnpm run typecheck` (tsc --noEmit): clean.
- Targeted test suites for every file with a logic change:
  - vault + adapters: 165 tests, 0 fail.
  - admin + auth + http-middleware + oauth: 70 tests, 0 fail.
- Docker/CI findings that require building an image were **not** built (owner
  policy: never build); they are marked pending with an explicit verify step.

## ✅ Applied and verified

| ID | Finding | Change | File(s) | Verified by |
| --- | --- | --- | --- | --- |
| SEC-02 | Admin routes can be unauthenticated | Fail closed; unauthenticated admin now returns `503` unless `LLM_GATEWAY_ADMIN_ALLOW_NOAUTH=true` | `src/server/admin.ts` | admin tests green |
| SEC-03 | Unsafe network exposure by default | Bind `127.0.0.1` by default; override via `LLM_GATEWAY_HOST` | `src/server/http.ts` | typecheck + http tests |
| SEC-08 | OAuth allowlist defaulted to allow-all | Fail closed: deny when `GITHUB_ALLOWED_USERS` unset | `src/auth/github-oauth.ts` | oauth tests green |
| SEC-10 | Correlation IDs unbounded | Accept only `^[A-Za-z0-9._-]{1,128}$`, else generate a UUID | `src/server/http-app.ts` | http-middleware tests |
| DOC-01 | Adapter count / version drift | README `11 → 17` adapters (11 API + 6 CLI), health example `0.3.1 → 0.6.0`, `total 11 → 17` | `README.md` | fact-checked vs `VALID_PROVIDERS` |
| DEL-01 | Publication not gated by CI | Added `verify` job (install/typecheck/test/build); `build-and-push` now `needs: verify` | `.github/workflows/docker.yml` | workflow structure |
| SEC-11 | Vault path not permission/symlink validated | Reject symlinked DB path; `chmod 0600` on the DB file at startup | `src/vault/vault.ts` | vault tests green (165) |
| RUN-02 | Sync CLI blocks the event loop | Request-path adapters swapped `execCliSync → execCliAsync` (setup path left sync) | `src/adapters/base-cli-adapter.ts`, `cli-copilot.ts`, `cli-opencode.ts` | adapter tests green |

## ✅ Applied later (PRs #21–#33, 2026-09)

These were still listed as skipped below. They shipped on `main` after the original status table.

| ID | Finding | Change | PR |
| --- | --- | --- | --- |
| RUN-01 | HTTP timeout did not cancel work | Deadline abort on generate/chat (`abortSignal` + 408) | #25 |
| RUN-03 | Shutdown discarded HTTP/MCP handles | Retain listen handles; close HTTP then MCP; drain window then `closeAllConnections` (`SHUTDOWN_DRAIN_MS`, default 5s) | #30, #32 |
| SEC-12 | Raw `error.message` on HTTP/MCP | `publicErrorMessage` / sink redaction on admin, observability, remaining routes, SQLite logs | #24, #26, #27, #31 |
| — | CLI abort left children | Process-group kill via detached `spawn` | #28 |
| — | Copilot non-interactive tools | Deny shell/write; keep `--allow-all-tools` | #29 |
| — | Local LLM contract | Contractual local-llm routing | #21 |
| — | Model discovery union / global creds | API prune of stale declared ids; generate-path discovery uses `request.project` | #33 (issues #2, #3) |
| SEC-09 | Client IP from spoofable header | Rate-limit key is the socket peer; forwarding headers only if `TRUSTED_PROXY_IPS` contains that peer | `src/server/http-helpers/client-ip.ts` |

### Operator notes (behavior changes to be aware of)

- **VPS exposure**: with SEC-03, the process now binds loopback by default. To
  expose it on the VPS, set `LLM_GATEWAY_HOST=0.0.0.0` (or run behind a reverse
  proxy). Otherwise it is only reachable from localhost.
- **Admin auth**: with SEC-02, if no `ADMIN_TOKEN`/`AUTH_TOKEN` is configured,
  admin routes return `503`. For local no-auth admin set
  `LLM_GATEWAY_ADMIN_ALLOW_NOAUTH=true`; on the VPS configure a real token.
- **OAuth**: with SEC-08, dashboard OAuth now requires `GITHUB_ALLOWED_USERS`
  (e.g. your handle). No-op if OAuth is unused.
- **Rate-limit IP**: with SEC-09, `X-Real-IP` / `X-Forwarded-For` are ignored
  unless the TCP peer is listed in `TRUSTED_PROXY_IPS` (the reverse-proxy
  address, not the client). Behind nginx, set that env or every client shares
  the proxy's IP bucket.

## ✅ Applied and verified — Docker

Applied and verified end-to-end with an actual `docker build` + container run
(explicitly authorized). The runtime now runs the built artifact, not `tsx`.

| ID | Finding | Change | File(s) | Verified by |
| --- | --- | --- | --- | --- |
| RUN-04 | `model-routing.json` not packaged / path bundle-sensitive | `loadConfig()` now resolves config with explicit precedence (env → cwd → next-to-module → repo-root); tsup copies `model-routing.json` into `dist` | `src/model-routing/config.ts`, `tsup.config.ts` | `loadConfig()` imported from the built `dist` chunk in a foreign cwd returns config (not `null`) |
| DEL-03 | Runtime image ships dev toolchain and runs `tsx src` | 3-stage build: dashboard → `app-build` (compiles `dist`) → runtime installs `--prod` only, `CMD ["node", "dist/index.js", "serve"]` | `Dockerfile` | container runs; `CMD` is `[node dist/index.js serve]`; `/health` returns 0.6.0 / 17 providers |
| DEL-02 | Docker build non-reproducible / fail-open | Added `.dockerignore` (no more `.git`/`node_modules`/`.env` in context); optional OpenCode checksum via `--build-arg OPENCODE_SHA256`; explicit per-CLI install (no blanket `\|\| true`); explicit `COPY` allowlist instead of `COPY . .` | `Dockerfile`, `.dockerignore` | `docker build` exit 0; image `mcp-llm-bridge:audit-test` |

### Verification evidence

- `pnpm run typecheck`: clean. `pnpm run build`: success; `dist/model-routing.json`
  and `dist/migrations/` present.
- Built artifact run from a foreign cwd: boots, serves `/health`
  (version 0.6.0, providers 17), binds loopback by default (SEC-03).
- `docker build -t mcp-llm-bridge:audit-test .`: exit 0.
- `docker run` + `/health`: healthy; effective `CMD` is `node dist/index.js serve`;
  no model-routing-missing error inside the container.

### Follow-ups (optional, not blocking)

- **OpenCode checksum**: pass a real `--build-arg OPENCODE_SHA256=<sha256>` to turn
  the checksum from optional into enforced. Currently logs a skip warning.
- **npm CLI pins**: provider CLIs are installed unpinned (best-effort). Pin exact
  versions once known if reproducibility of the CLI layer matters.
- **Non-root user**: still runs as root to avoid breaking a root-owned mounted
  vault volume on the VPS. Switch to `USER node` once volume ownership is aligned.
- **sharp/protobufjs**: their build scripts are skipped in the prod install (same
  as before); prebuilt binaries are used. Revisit only if an embedding/transformer
  feature fails at runtime.

## ⏭️ Skipped for this threat model (real, but low value without untrusted tenants)

All CONFIRMED against current code; documented in the domain files. Revisit only
if this is ever exposed to untrusted third parties.

| ID | Finding | Why skipped here |
| --- | --- | --- |
| SEC-01 | Project scope not bound to authenticated key | Cross-tenant isolation; only applies in multi-tenant mode with untrusted keys |
| SEC-04 | Sandbox falls back to host | Default profile has sandbox off; no untrusted command source |
| SEC-05 | Plugins run in-process | Plugins are operator-supplied, not attacker-controlled |
| SEC-06 | Temp provider-home collision/race | Cross-tenant concern; borderline hygiene at real concurrency |
| SEC-07 | Body/field limits incomplete | DoS/cost-abuse control against untrusted callers |
| ARC-01/02/03 | Contract/router/DB-lifecycle consolidation | Architecture insurance; pays off with multiple maintainers |
| DEL-04/05 | Coverage thresholds / npm contract | Value depends on public npm publish intent |
| API-01/02 | OpenAI subset / no OpenAPI contract | Doc-first; full contract suite is a future SDD change |
| DOC-02 | Dashboard docs/tests generic | Lowest priority (P3); only matters if open-sourced/handed off |

## Suggested next steps

1. **Set VPS env before deploying** the reworked image: `LLM_GATEWAY_HOST=0.0.0.0`,
   plus `ADMIN_TOKEN` (and `GITHUB_ALLOWED_USERS` if OAuth is used). Without these
   the container binds localhost-only and admin routes return `503`.
2. Optionally enforce the OpenCode checksum (`--build-arg OPENCODE_SHA256=...`).
3. The remaining skipped findings stay documented for a future multi-tenant/
   public-exposure scenario. There is no further single-tenant hardening queue.
