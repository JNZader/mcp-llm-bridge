# ERR-HTTP-ADMIN-A: route-containment acceptance map

## Decision

`ERR-HTTP-ADMIN-A` is **scoped verified** for seven owned Admin-A route registrations: eight injected generic-failure invocations return the exact generic 500 `INTERNAL_ERROR` envelope, and five `NOT_CONFIGURED` branches retain their contract. This is not canonical admission of the aggregate `SAFE-HA-01..10` range, full authentication/application proof, review PASS, delivery, or WP00 closure.

## Executed receipt

The verified candidate contains 45 source paths: the prior 43-path candidate plus `src/server/routes/admin/operations.ts` and `test/wp00/err-http-admin-a-isolated.test.ts`. Current candidate manifest: `7f8591a67acf44f48a008232b4ac538e9bea13b2d8de3f8628a801c550bc997d`. The current test SHA-256 is `90fbda18948b3a32a214b949badc14eaec43452be74253017f1d8b35d089af85`. A read-only manifest reconciliation excluded exactly that owned test path and matched all remaining 44 mode/hash/path entries; reconciled nonowned manifest SHA-256: `6d2404980faf4a403a34e0c9d3df36fc3a420218dfa35a41bd99a6d6a8cf8a3b`.

| Evidence | Result |
|---|---|
| Focused gate | `timeout 30s node --import tsx --test test/wp00/err-http-admin-a-isolated.test.ts`; exit `0`; cwd `/work/.err-http-admin-a-c1-red-20260910`; **13/13** pass; [log](/tmp/err-http-admin-a-literal-final-20260910/artifacts/focused.log) SHA-256 `ffa15a84441cc8f919f8c16fbcd63dc77a38ba109cdef18cc850c235f22f6b17`. |
| Typecheck | `/work/node_modules/.bin/tsc --noEmit -p tsconfig.json`; exit `0`; same cwd; empty [log](/tmp/err-http-admin-a-literal-final-20260910/artifacts/tsc.log) SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |
| Current proof | [final-proof.json](/tmp/err-http-admin-a-literal-final-20260910/artifacts/final-proof.json), SHA-256 `f72cfd331ec296898309b8aa82fa68ea46681aed34967f6897b95943d8cf864e`. Local `/tmp` locators are nonportable. |
| Patches | [literal-oracle.patch](/tmp/admin-a-literal-correction-20260910/literal-oracle.patch), SHA-256 `2005b36d867a0f82ea18601fbd2400a2bc1cb274bd735f120e7f76280bfc0f3e`, layered on prior [admin-a-2path-preimage.patch](/tmp/err-http-admin-a-established-final-20260910/artifacts/admin-a-2path-preimage.patch), SHA-256 `1e83863bc4038ee5b5656bd7bce34e0dc8f721bc7c83b01483c57aee75a04ce2`; this is not a new full patch. |

The expected RED was TS2322: the structural test tracker was not assignable to nominal `CostTracker`. The sole production change narrowed `AdminOperationsRouteDeps.costTracker` to `Pick<CostTracker, 'bufferSize' | 'flush'>`; route-body bytes remain unchanged and the real `CostTracker` remains compatible. The prior `d6721bd…` proof is retained as a 13/13 runtime pass whose generic-message oracle was helper-derived. The literal correction removed that import and asserts the public message independently; it is test-only, not a new runtime bug fix. A first literal-proof artifact (`1e3903d…`) is historical/blocked because its post-gate manifest filter failed to exclude the owned test path (45 prior rows versus 44 current), not because of a demonstrated source mutation. The final proof preserves that blocker and records the parent read-only mode/hash/path reconciliation of all 44 remaining entries without source changes or test reruns. Earlier fixture-compile, status-literal, and missing-`rg`/`.git` runner failures remain incidental historical harness issues, not product failures.

## Defined coverage

| Owned behavior | Executed assertion | Scope conclusion |
|---|---|---|
| API key registrations | `POST`, `GET`, and `DELETE` key routes each contain one injected database `prepare` failure; each returns the literal-independent exact generic 500 `INTERNAL_ERROR`, invokes the expected dependency once, leaves irrelevant guards untouched, leaks no hostile getter/coercion canary, and bypasses `app.onError` ([test](../../../test/wp00/err-http-admin-a-isolated.test.ts) lines 142-157; [registrar](../../../src/server/routes/admin/api-keys.ts) lines 42-133). | **Scoped verified:** three generic failures plus three preserved database `NOT_CONFIGURED` branches (test lines 233-244). |
| Discovery registrations | Catalog refresh contains injected catalog-load failure. Discover independently contains `getSlimLocalLLMStatus` and `discoverModels` failures, yielding two failure stages on the same registered route ([test](../../../test/wp00/err-http-admin-a-isolated.test.ts) lines 159-189; [registrar](../../../src/server/routes/admin/discovery.ts) lines 28-89). | **Scoped verified:** three generic-failure invocations; catalog `NOT_CONFIGURED` remains 404 before loader access (test lines 246-257). |
| Operations registrations | Reset-breaker state read and structural tracker `flush` failures are contained; the breaker fake is restored in `finally` ([test](../../../test/wp00/err-http-admin-a-isolated.test.ts) lines 191-230; [registrar](../../../src/server/routes/admin/operations.ts) lines 7-52). | **Scoped verified:** two generic-failure invocations; tracker-missing `NOT_CONFIGURED` remains 404 (test lines 260-266). |
| Matrix total | Seven path/method registrations: three key routes, refresh, discover, reset breaker, and flush. Discover has two independently injected stages. | **Scoped verified:** eight generic failure invocations + five normative `NOT_CONFIGURED` branches = 13 focused tests. This is a test matrix, not an invented `SAFE-HA-01..10` mapping. |

## Explicit limits

- `SAFE-HA-01..10` remains an aggregate historical range; individual definitions were not found in the bounded search. This map does not claim 10/10 or assign those IDs meanings.
- The isolated Hono `app.request()` fixture registers all three actual Admin-A registrars with guarded database/free-router sentinels. It instantiates no `CostTracker`, database, free router, Vault, provider, detector, network, catalog filesystem, listener, or full application constructor.
- The old mixed test filename's profile and sync behavior belongs to later `ERR-HTTP-ADMIN-B` ownership and is excluded. No full authentication, CSRF, listener, database, provider, route-catalog, or application claim follows.
- The scoped functional checker confirmed the literal-oracle finding resolved with prior assertions intact and matching patch/test/proof hashes. This is not a full-candidate review or formal approval.

## Next action

`ERR-HTTP-API-A` is the next known W03 row. Perform only a bounded reconciliation of its owned sources and canonical acceptance before proposing or implementing anything. Do not jump to the W04 Admin-B unit or reopen this scoped Admin-A boundary without a new requirement.
