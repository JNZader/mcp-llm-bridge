# ERR-ACP: raw single-request acceptance map

## Decision

`ERR-ACP` is **scoped verified** for the defined ten ACP numeric error-code/message fixtures and the approved `AcpServer.handleRawRequest(rawJson)` single-request boundary. This is not a canonical admission of any historical ACP scenario range, a complete JSON-RPC transport, a socket/framing implementation, a review PASS, delivery, or WP00 closure.

## Executed receipt

The verified candidate contained 43 source paths: the prior 39-path candidate plus four ACP source/test paths; the contract document is recorded separately. Candidate manifest: `1ebb2b85e1c8fdda972c83733dede6dbffccf38710054c7b11a469dfe16e102c`.

| Evidence | Result |
|---|---|
| Final focused gate | `timeout 30s node --import tsx --test test/wp00/err-acp-server.test.ts`; exit `0`; cwd `/work/.acp-raw-json-dispatch-c2-20260910`; **23/23** pass across two suites; [log](/tmp/acp-raw-json-dispatch-final-20260910/artifacts/focused-test.log) SHA-256 `e948eec97c8f617b89d9b9ca1f9d3a1139cf4b455150cb252424e848a2c796c1`. |
| Final typecheck | `/work/node_modules/.bin/tsc --noEmit -p tsconfig.json`; exit `0`; same cwd; empty [log](/tmp/acp-raw-json-dispatch-final-20260910/artifacts/tsc.log) SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |
| Current proof | [proof.json](/tmp/acp-raw-json-dispatch-final-20260910/artifacts/proof.json), SHA-256 `a86457df1dfa64535bb3138467d257305ea4c8574107309917ea7787d0ac3620`. The local `/tmp` locators are nonportable. |
| C2 test-only patch | [dispatch-assertion-test-only.patch](/tmp/acp-raw-json-dispatch-final-20260910/artifacts/dispatch-assertion-test-only.patch), SHA-256 `3d3de54dfa2d28caa869e45d82c92dca408631b3c20a842731dde3ae3323ba0b`; final combined five-path patch SHA-256 `162f5593359fdedf0996ddd9b6a1eabfa8ac07638757c8e0f20de8af1599b7a9`. |

The retained history records the expected RED (23 tests: 20 pass, three failures because the method was absent), an initial 23/23 green result, then `tsc` exit `2` with TS2352. One correction replaced the unsupported direct assertion with a real type predicate. The previous runtime-pass proof (`c61b8a24…`) lacked direct zero-`handleRequest` assertions for invalid raw input; C2 changes only `test/wp00/err-acp-server.test.ts`, adding those assertions while retaining prior checks. The final gate and typecheck above are the current execution evidence. C2's source-only pre/post manifest matched 42 nonowned source paths, including unchanged production. The contract preimage caveat remains: it was reconstructed by removing the uniquely added raw-adapter paragraph and is **not** an independent full pre-edit snapshot of foreign contract content or a complete foreign-file identity proof.

## Defined coverage

| Defined behavior | Requirement / source | Executed assertion | Scope conclusion |
|---|---|---|---|
| Ten numeric fixtures and exact messages | The inventory is fixed in [contracts.md](../../../openspec/changes/containment-and-evidence-harness/design/contracts.md) (line 131): `-32001..-32005`, `-32700`, `-32600`, `-32601`, `-32602`, and `-32603`. | Existing typed-handler assertions plus the raw-boundary cases in [err-acp-server.test.ts](../../../test/wp00/err-acp-server.test.ts) (lines 133-182) retain the exact messages; the final focused suite is 23/23. | **Scoped verified.** `23` is a test count, not a claim of 23 numeric codes or invented ACP scenario IDs. |
| Malformed raw JSON | The approved boundary requires parse errors to return id `null` ([contracts.md](../../../openspec/changes/containment-and-evidence-harness/design/contracts.md) line 133). | The malformed JSON case returns `-32700`, `Parse error.`, id `null`, and the shared recording handler proves **zero typed `handleRequest` calls** ([test](../../../test/wp00/err-acp-server.test.ts) line 150). | **Scoped verified.** |
| Invalid raw single request | The boundary accepts one object request only; invalid requests recover only a string or safe-integer id, otherwise `null` ([contracts.md](../../../openspec/changes/containment-and-evidence-harness/design/contracts.md) line 133). | The table covers null/primitive/array input, missing or unsafe ids, wrong version/method, null/object-incompatible parameters, and positional arrays. The shared recording handler directly proves **zero typed `handleRequest` calls for every entry**, including `-32602` positional parameters ([test](../../../test/wp00/err-acp-server.test.ts) line 173). | **Scoped verified.** Positional arrays receive `-32602`; other structural violations receive `-32600`. |
| Valid raw request delegation | `handleRawRequest` decodes then delegates to the unchanged typed handler ([server.ts](../../../src/acp/server.ts) lines 97-129, 271-275). | The recording subclass receives the parsed request **exactly once** and still exercises unknown-method `-32601` ([test](../../../test/wp00/err-acp-server.test.ts) line 182). | **Scoped verified.** No copied dispatcher model was tested. |
| Public response typing | The public types preserve normal typed responses while adding nullable raw-input errors ([types.ts](../../../src/acp/types.ts) lines 30-35; [index.ts](../../../src/acp/index.ts) lines 12-18). | The final `tsc --noEmit` above exits 0 after the type-guard correction. | **Scoped verified** for this candidate's type surface. |

## Explicit limits

- This is a **request-only API**, not general JSON-RPC transport: batch arrays, notification-shaped missing-id input, framing, serialization, stdin, ports, sockets, network, database, providers, and runtime bootstrap are excluded. The implementation rejects batches and notifications rather than supporting them.
- The raw adapter accepts object-named parameters only. Positional arrays are intentionally `-32602`.
- IDs are strings or safe integers. Parse errors use `null`; invalid requests expose only safely recoverable ids. The error convention is informed by the [JSON-RPC specification](https://www.jsonrpc.org/specification), but ACP does not claim transport compliance.
- Duplicate JSON keys retain native `JSON.parse` last-key-wins behavior; lexical duplicate-key rejection is not implemented or claimed.
- `handleRequest` remains unchanged. No full-transport, package, listener, delivery, review, or WP00 conclusion follows. The bounded functional check identified the missing zero-dispatch assertion; the scoped C2 readback confirmed that finding resolved with prior checks intact. This resolution is not a full-candidate review or approval.

## Next action

The approved raw-boundary choice is complete. The next known W03 row is `ERR-HTTP-ADMIN-A`; begin only a **bounded reconciliation** of its owned sources and canonical acceptance gap before proposing or implementing anything. Do not reopen the defined ERR-ACP boundary without a new requirement.
