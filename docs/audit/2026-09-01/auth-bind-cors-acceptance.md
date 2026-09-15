# AUTH-BIND-CORS: requirements-based acceptance map

## Decision

`AUTH-BIND-CORS` is **scoped verified for the defined bind/CORS requirements below**. It is not a canonical admission of the historical `HTTP-BIND-01..06` and `CORS-01..10` ranges, because a bounded tracked/history search found only those aggregate labels, not individual scenario definitions. It is not a package, runtime, WP00, review, or delivery conclusion.

## Candidate and retained evidence

The executed candidate contained 39 source paths: the runtime 29-path prerequisite, the AUTH-BIND-CORS implementation 9-path overlay, and one test-only production-factory path. The only new path for this receipt was [`test/wp00/auth-bind-cors-production.test.ts`](../../../test/wp00/auth-bind-cors-production.test.ts), SHA-256 `5adb89cb6022f8a0166e5619d6d6feb80783a315b2a5cbbf8c2ac9b54a048f16`; no production source or configuration file changed.

| Receipt | Evidence |
|---|---|
| Candidate identity | 39 paths; manifest `c4d630d9b2d1883828dadd982e2de5063811732ecae0a6a87f4bff605c152dbf`; proof [`proof.json`](/tmp/auth-bind-cors-production-wiring-final-20260910/artifacts/proof.json), SHA-256 `c55b46c67fc563070b4248317c1ac38eec7cefc0be8dc7b0442fb57236929bfc`. |
| Production-factory test | [executed] cmd=`timeout 30s node --import tsx --test test/wp00/auth-bind-cors-production.test.ts` exit=0 cwd=`/work/.auth-bind-cors-production-wiring-20260910`; 2/2 passed. Log SHA-256 `a8ba4806455b16bda555a2c7b3d24e32c81e6572bbd63c98fa82b28b3be76057`. |
| Combined focused test | [executed] cmd=`timeout 30s node --import tsx --test test/wp00/auth-bind-cors.test.ts test/http-runtime-config.test.ts test/wp00/auth-runtime.test.ts test/server/auth-helpers/bearer.test.ts test/wp00/auth-bind-cors-production.test.ts` exit=0 cwd=`/work/.auth-bind-cors-production-wiring-20260910`; 21/21 in 5 suites passed. Log SHA-256 `dea21d32e3238520b65479258ad944b971a9dd9fcfd7bb664c281fc0adce321f`. |
| Typecheck | [executed] cmd=`/work/node_modules/.bin/tsc --noEmit -p tsconfig.json` exit=0 cwd=`/work/.auth-bind-cors-production-wiring-20260910`; empty log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |

`/tmp` locators identify retained local evidence and are nonportable; the repository-relative test and design links above are the durable references.

## Requirements map

| Requirement / contract | Normative text | Current source/test assertion | Evidence level and conclusion |
|---|---|---|---|
| `REQ-HTTP-01` default exposure | The service must default to loopback/private exposure; non-loopback exposure requires explicit trusted configuration and static authentication, and incomplete configuration must not widen exposure. [Spec](../../../openspec/changes/containment-and-evidence-harness/specs/default-deny-containment/spec.md) (lines 18-31). | Helper tests cover default/explicit loopback without a real listener, reject blank/public/weak-token/admin-only binds before fake `serve`, and allow non-loopback only with a valid gateway token ([test](../../../test/wp00/auth-bind-cors.test.ts) (lines 44-98)). | **Scoped verified.** This proves the defined configuration/bind guard with an injected fake `serve`; it does not execute actual socket binding or remote traffic. |
| CORS middleware contract | CORS permits exactly `GET,POST,PUT,PATCH,DELETE,OPTIONS` and named headers including `X-CSRF-Token`; credentials require an exact configured origin; valid preflight is 204 and missing/invalid preflight Origin is the exact 403 envelope. [Contract](../../../openspec/changes/containment-and-evidence-harness/design/contracts.md) (line 39). | Helper assertions cover exact policy headers and downstream suppression ([test](../../../test/wp00/auth-bind-cors.test.ts) (lines 100-144)). Actual `createHttpApp(...).request()` asserts allowed PATCH 204 headers, missing/disallowed preflight 403 envelope, and allowed/disallowed ordinary-origin headers ([test](../../../test/wp00/auth-bind-cors-production.test.ts) (lines 77-145)). | **Scoped verified.** The CORS policy and its app assembly order are exercised without protected services. |
| Protected application boundary | This is implementation coverage beyond the stated bind/CORS requirement text: a request with missing auth returns **401** while allowed Origin receives CORS headers and disallowed Origin receives neither ACAO nor ACAC. | Production-factory test uses throw-on-use Router/Vault and verifies zero calls ([test](../../../test/wp00/auth-bind-cors-production.test.ts) (lines 56-145)). `db` and `groupStore` are omitted; scoped environment is restored. | **Extra implementation coverage, executed.** It does not establish an all-route authentication requirement or AUTH-ADMIN behavior. |
| Proxy and lexical origin hardening | Trusted-peer XFF resolution and rejection of raw configured path/query/fragment syntax before URL canonicalization are implementation hardening beyond the defined bind/CORS rows. | Trusted-peer/right-to-left XFF assertions ([test](../../../test/wp00/auth-bind-cors.test.ts) (lines 146-163)); lexical-origin/default-port checks ([test](../../../test/http-runtime-config.test.ts) (lines 39-63)). | **Extra implementation coverage, executed.** It supports the current helper boundary but does not enlarge the normative claim. |

## Exclusions and ownership

- `startHttpServerWithDeps` and actual `serve` are source-wired but not executed: a real listener would open a port. This is an optional integration follow-up, not a demonstrated normative blocker.
- Static SQLite imports do not mean this receipt opened a database: `db` is omitted. No provider, network, runtime bootstrap, package qualification, MCP, or listener was exercised.
- Health, OAuth, OPTIONS/auth-config bearer exceptions, and separately admin-auth-guarded routes are unchanged and unexecuted here. Missing-credential behavior for `AUTH-ADMIN` remains in that unit; this map invents no all-route-auth requirement.
- The aggregate `HTTP-BIND-01..06` and `CORS-01..10` labels appear in the DAG ([ranges](../../../openspec/changes/containment-and-evidence-harness/design/scenarios-dag.md) (lines 197, 266)); their individual definitions were **not found in the bounded tracked/history search**. No row above assigns meanings or claims 16/16.

## Next action

Preserve this scoped evidence. If a later requirement needs real listener behavior, first define a no-port integration contract for `startHttpServerWithDeps`/`serve`; otherwise it is not an immediate blocker. `ERR-ACP` remains independently eligible and is not blocked by listener proof.
