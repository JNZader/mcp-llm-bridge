# ERR-MCP-SECURITY acceptance map

## Decision and boundary

`ERR-MCP-SECURITY` is **requirements-based scoped verified** for the public MCP `ProfileEnforcer.wrapHandlers` deny/rate and delegation behavior exercised by the retained candidate. The DAG assigns the unit to `security/enforcer.ts:wrapHandlers` and names only aggregate `MCP-SEC-01..06` deny/rate ownership; individual scenario definitions were not recovered, so this receipt does not admit those IDs, full security, runtime, delivery, or WP00 closure.

The checked boundary is `wrapHandlers` authorization before rate checking (`src/security/enforcer.ts:226-269`), with a fixture that connects an MCP client/server through `InMemoryTransport` (`test/wp00/err-mcp-security.test.ts:23-43`). It is separate from `ERR-MCP-SERVER` handler-failure containment and does not resolve the remaining universal delegate-failure obligation.

## Executed assertion map

| Existing assertion | Result and scope |
|---|---|
| Denial before quota and no delegation | Restricted-profile calls to an unknown canary and `vault_store` return the literal denial, do not leak the canary, execute zero rate checks, and make zero delegate calls (`test/wp00/err-mcp-security.test.ts:54-71`). |
| Exhausted quota | Open-profile `llm_generate` succeeds ten times, then returns the literal rate-limit response with no eleventh delegate call (`:73-82`). |
| Hostile retry metadata | A rejecting `checkRate` result with a throwing `retryAfter` getter returns the literal rate-limit response without reading that getter or delegating (`:84-96`). |
| Tool filtering and dynamic metadata | Restricted listing retains permitted built-in/dynamic metadata, then the registered dynamic read tool delegates with its exact arguments (`:98-108`). Open-profile listing hides and denies the disallowed dynamic tool (`:110-118`). |
| Success and default arguments | Local-dev permitted calls preserve a nested argument object, and a missing argument is delegated as `{}` (`:120-129`). |

## Executed receipt

| Evidence item | Retained result |
|---|---|
| Candidate | 50 paths: the 48-path API-A candidate plus current `src/security/enforcer.ts` and `test/wp00/err-mcp-security.test.ts`. The prior 48 current-host rows match the retained manifest after order normalization; source/test mode and bytes matched scratch before and after the gates. |
| Focused gate | `timeout 60s node --import tsx --test test/wp00/err-mcp-security.test.ts`, cwd `/work/.mcp-security-focused-20260910`, exit `0`: 7 tests in one suite, 7 pass, 0 fail. |
| Typecheck | `/work/node_modules/.bin/tsc --noEmit -p tsconfig.json`, same cwd, exit `0` with no diagnostics. |
| Proof | [Final proof](/tmp/mcp-security-focused-20260910/artifacts/proof.json), SHA-256 `be4315033e54feca805746f024f548a084c24f86677df7f554152426058435ed`. It records exact command/cwd/exit/log hashes, candidate manifests, cleanup, and exclusions; `/tmp` locators are nonportable. |
| Metadata history | The initial proof (`proof-initial-summary-metadata.json`, SHA-256 `207825db436df573aacad6408d863eb2707a2ad62ee4cff26a7e2269d1ec6b01`) preserved empty count arrays caused by a proof-only regex escape. The final proof reads 7/1/7/0 from the unchanged TAP log; no command was rerun and no candidate bytes changed. |
| Runtime isolation | Node `v22.23.2` ran in the approved offline container with no mounts or attached networks. The fixture uses `InMemoryTransport`; no listener, network, provider, Vault, bootstrap, real environment, or project/persistent/RAM database was opened. Cleanup left no Node test process. |

## Exclusions and next action

This receipt does not admit aggregate `MCP-SEC-01..06`, prove universal delegate-failure containment, or close `ERR-MCP-SERVER`, HTTP security, full runtime security, or WP00. It is not evidence for a real MCP listener, provider, persistent storage, Vault, bootstrap, or environment integration.

The next known W03 unit is `HEALTH-REGISTRY`: perform a bounded requirements/evidence reconciliation before any implementation proposal. Scanner parallel readiness remains planning-only and is not aggregate scanner admission.

<!-- evidence:begin -->
- [executed] The focused MCP-security suite passed. cmd=`timeout 60s node --import tsx --test test/wp00/err-mcp-security.test.ts` exit=0 cwd=/work/.mcp-security-focused-20260910
- [executed] The isolated no-emit typecheck passed. cmd=`/work/node_modules/.bin/tsc --noEmit -p tsconfig.json` exit=0 cwd=/work/.mcp-security-focused-20260910
- [read] The source wraps MCP ListTools/CallTool handlers and applies authorization before rate limiting. src=src/security/enforcer.ts:226-269
- [read] The DAG assigns aggregate deny/rate ownership to ERR-MCP-SECURITY and handler failures to ERR-MCP-SERVER. src=openspec/changes/containment-and-evidence-harness/design/scenarios-dag.md:190,261-262
<!-- evidence:end -->
