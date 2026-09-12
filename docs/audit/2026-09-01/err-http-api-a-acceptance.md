# ERR-HTTP-API-A acceptance map

## Decision and boundary

`ERR-HTTP-API-A` is **requirements-based scoped verified** for the named HTTP API error-containment behaviors exercised by the retained candidate. This is not an admission of aggregate `SAFE-HC-01..12`: the bounded tracked/history reconciliation did not recover individual definitions for those labels. It is also not full authentication, runtime, delivery, or WP00 closure.

The evidence concerns nine route registrations across four response-envelope families:

| Family | Verified registrations and source | Scoped behavior exercised | Boundary |
|---|---|---|---|
| OpenAI nested envelope | `POST /v1/chat/completions` — [`src/server/routes/execution.ts:185`](../../../src/server/routes/execution.ts#L185) | The OpenAI-facing registration keeps its nested error envelope and exact literal error messages under the existing API suite. | This is not a claim about every OpenAI route or a canonical SAFE-HC label. |
| Anthropic envelope | `POST /v1/messages` — [`src/server/routes/messages.ts:122`](../../../src/server/routes/messages.ts#L122) | The messages registration keeps the Anthropic error-envelope shape under the existing streaming/validation suites. | This is not full Anthropic protocol or provider evidence. |
| Generate flat specific envelope | `POST /v1/generate` — [`src/server/routes/execution.ts:157`](../../../src/server/routes/execution.ts#L157) | Generate behavior keeps its flat, route-specific error envelope and existing validation boundary coverage. | The tested 512K prompt boundary is execution evidence only; no individual SAFE-HC ID is assigned to it. |
| Comparison and groups flat specific envelopes | `POST /v1/compare`, `GET /v1/compare/history` — [`src/server/routes/comparison.ts:60`](../../../src/server/routes/comparison.ts#L60), [`src/server/routes/comparison.ts:99`](../../../src/server/routes/comparison.ts#L99); `GET`/`POST /v1/groups`, `PUT`/`DELETE /v1/groups/:id` — [`src/server/routes/groups.ts:28`](../../../src/server/routes/groups.ts#L28), [`src/server/routes/groups.ts:37`](../../../src/server/routes/groups.ts#L37), [`src/server/routes/groups.ts:53`](../../../src/server/routes/groups.ts#L53), [`src/server/routes/groups.ts:77`](../../../src/server/routes/groups.ts#L77) | Comparison actions/history and groups registrations keep their own flat, route-specific error responses. | These slices do not prove persistent-storage, full application, or canonical aggregate acceptance. |

## Executed receipt

| Evidence item | Retained result |
|---|---|
| Candidate | 48 source paths; host/container mode-and-byte manifest SHA-256 `a943d03ba7d68f8d69963cfecbd4ec59b65cd612fb774484a23abf58d37fd8a6`. The 45 non-owned paths matched before/after, SHA-256 `7f8591a67acf44f48a008232b4ac538e9bea13b2d8de3f8628a801c550bc997d`. |
| Test-only delta | Only `test/wp00/err-http-api.test.ts`, `test/wp00/err-http-streaming.test.ts`, and `test/wp00/err-http-validation.test.ts` changed. They now assert independent public literals for `INTERNAL_ERROR` and `INVALID_REQUEST`; no production source, configuration, fixture, or API changed. The retained three-path preimage patch SHA-256 is `bc1c71695d271d9d22746a344933c829f2b3c031fb0c8c38ef8233a830501c0e`. |
| Focused command | `timeout 60s node --import tsx --test test/wp00/err-http-api.test.ts test/wp00/err-http-streaming.test.ts test/wp00/err-http-validation.test.ts test/wp00/err-http-comparison-actions.test.ts test/wp00/err-http-comparison-validation.test.ts test/wp00/err-http-comparison-history.test.ts test/wp00/err-http-groups.test.ts` exited `0`: 198 tests in seven suites, 198 pass, 0 fail. Focused-log SHA-256 `0ed0c5e03dea7e5654e906cca6d2dbbd005ffe5e9762500599d48bb060a23439`. |
| Typecheck | `/work/node_modules/.bin/tsc --noEmit -p tsconfig.json` exited `0` with an empty log, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |
| Runtime | The isolated offline container was Node `v22.23.2`, `tsx 4.21.0`, and TypeScript `5.9.3`; it had no mounts or attached networks. The comparison-history and groups suites executed their existing SQLite `:memory:` lifecycle only. No project or persistent database, provider, network, listener, bootstrap, or Vault was used. |
| Proof | [Retained proof](/tmp/api-a-oracle-final-20260910/artifacts/proof.json), SHA-256 `024e26603dd1d30abb0cc790e069e442bd58b03dbc499e040461cd5267d45a59`. It contains exact command/cwd/exit records, all source hashes, manifests, patch locator, cleanup evidence, and exclusions. `/tmp` locators are nonportable. |

## Source and assertion scope

The seven existing suites cover the execution, message, comparison-action, comparison-validation, comparison-history, and group-route families. The three changed suites retain their pre-existing cases and counts; the only delta removes `safeError`/`toSafeHttpError`-derived expectations and substitutes independent contract literals. That makes a public error-message regression observable without copying the production helper into the expected value.

Existing comparison-history and groups tests construct temporary in-memory SQLite databases and close them as part of their established lifecycle. The executed receipt therefore establishes isolated RAM-database behavior only; it does not qualify a persistent/project database or a production storage integration.

## Exclusions and next action

This receipt does not define individual `SAFE-HC-01..12` meanings, admit those aggregate labels, prove all route/auth/runtime behavior, or close WP00. It does not execute real providers, network, listener, bootstrap, Vault, project database, or persistent database behavior.

The next known W03 work item is `ERR-MCP-SECURITY`: perform a bounded requirements/evidence reconciliation before proposing implementation. `ERR-HTTP-ADMIN-B` remains a W04 unit and is not the next item.

<!-- evidence:begin -->
- [executed] Seven existing API-A suites passed 198/198 tests. cmd=`timeout 60s node --import tsx --test test/wp00/err-http-api.test.ts test/wp00/err-http-streaming.test.ts test/wp00/err-http-validation.test.ts test/wp00/err-http-comparison-actions.test.ts test/wp00/err-http-comparison-validation.test.ts test/wp00/err-http-comparison-history.test.ts test/wp00/err-http-groups.test.ts` exit=0 cwd=`/work/.api-a-oracle-final-20260910`
- [executed] Candidate typecheck passed. cmd=`/work/node_modules/.bin/tsc --noEmit -p tsconfig.json` exit=0 cwd=`/work/.api-a-oracle-final-20260910`
- [read] The retained proof records candidate identity, non-owned preservation, focused logs, source hashes, cleanup, and explicit exclusions. src=`/tmp/api-a-oracle-final-20260910/artifacts/proof.json`
<!-- evidence:end -->
