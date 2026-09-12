# Qualify plugin workers before deployment

**Keep worker mode disabled until external qualification matches the exact installed worker and plugin root.** Legacy mode remains the default. Installed-package qualification passed for one built-in-only fixture on Node 22.23.2 / Linux x64; this is not qualification of your production plugin root or a runtime/platform compatibility matrix.

## Quick path

1. Build and pack the candidate, then extract the actual tarball into an isolated qualification environment. Preserve the tarball hash and use the dependency set recorded for that environment.
2. Run the installed-package acceptance command below with a fresh output path. Source-only tests, a successful build, and a manually computed tuple are not qualification.
3. Inspect the observed acceptance artifact and its scope. The supplied test qualifies only its temporary built-in-only fixture, **not your production plugin root**.
4. Obtain external qualification for the actual deployment root and unchanged worker bytes before supplying its five-field manifest. If that evidence is unavailable, retain legacy mode or leave dynamic plugins disabled.

## Configuration

| Variable | Default / behavior |
|---|---|
| `MCP_DYNAMIC_SERVERS` | Disabled unless exactly `true`; this is the outer plugin-loading gate. |
| `MCP_PLUGIN_RUNTIME_MODE` | Unset or empty selects `legacy`; explicitly set `worker` only after qualification. Other values fail with `CONFIG_INVALID`. |
| `MCP_SERVERS_DIR` | `./mcp-servers`; root containing `*.mcp-server.js` plugin entries. |
| `MCP_PLUGIN_WORKER_ENV_ALLOWLIST` | Empty by default: workers receive no parent environment variables. A comma-separated list copies only named variables that exist in the parent. Invalid names, duplicates, `NODE_OPTIONS`, and `NODE_PATH` are rejected. |
| `MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST` | No default. A JSON **value**, not a filename; required for worker admission. Missing, malformed, or mismatched evidence fails with `COMPATIBILITY_UNESTABLISHED` before plugin import. |
| `MCP_PLUGIN_LOAD_TIMEOUT_MS` | `5000`; import deadline used by installed worker loading. |
| `MCP_PLUGIN_TOOL_TIMEOUT_MS` | `10000`; observational invocation timeout used by installed worker loading. |

Worker construction explicitly uses empty `argv` and `execArgv`. Parent Node flags, preload hooks, and test-runner arguments are not inherited. The environment allowlist cannot reintroduce Node bootstrap configuration through `NODE_OPTIONS` or `NODE_PATH`; it is not a permissions sandbox.

The compatibility JSON must contain exactly these fields, with no additional keys:

| Field | Required evidence |
|---|---|
| `nodeMajor` | Positive integer matching the observed Node major version. Record the full tested Node version separately; matching a major is not proof of every minor version. |
| `platform` | Exact observed `process.platform`. |
| `arch` | Exact observed `process.arch`. |
| `workerEntryHash` | SHA-256 hex of the installed `dist/plugin-runtime-worker.js` bytes. |
| `installedPluginDigest` | SHA-256 hex of the complete qualified closed plugin-root digest described below. |

Do not construct an apparently valid tuple by copying current hashes into configuration. Hash equality binds existing evidence to bytes; it does not create compatibility evidence. Never reuse the temporary fixture's manifest for a different root, dependency closure, worker, or runtime tuple.

## Tools-only closed JSON protocol

Worker RPC exposes retained tools only, not resources, prompts, or arbitrary module exports. Both host and worker validate version `1` envelopes. Each envelope has exactly the fields shown below; unknown kinds and additional fields are rejected. `id?` means an optional request correlation ID on a failure.

| Kind | Closed fields |
|---|---|
| `ready` | `v`, `kind`, `manifest` |
| `invoke` | `v`, `kind`, `id`, `tool`, `args` |
| `result` | `v`, `kind`, `id`, `result` |
| `failure` | `v`, `kind`, `id?`, `code` |
| `shutdown` | `v`, `kind` |

The tools-only manifest contains exactly `v`, `name`, `version`, `description`, and `tools`. Each tool contains exactly `name`, `description`, `inputSchema`, and `security`; tool names use snake_case. Security contains a required `category` (`read`, `generate`, `destructive`, or `admin`) and an optional boolean `requiresApproval`. Host admission checks manifest identity against the plugin filename. Handlers, examples, resources, and prompts are not transferred in this manifest. Unknown fields at manifest, tool, and security levels are rejected; payload data in `inputSchema`, `args`, and `result` remains subject to the JSON bounds.

| Bound | Maximum |
|---|---|
| Encoded envelope / manifest | **1 MiB** of UTF-8 JSON |
| JSON nesting depth | **32**, with the validated root counted as depth 1 |
| Counted JSON nodes, array entries, and object keys | **10,000 total**; entries/keys and their values contribute to the shared traversal count |
| Individual strings and object keys | **256 KiB** UTF-8 |
| Request IDs | **128 bytes** UTF-8; IDs must be nonempty and duplicate live IDs are rejected |

The wire accepts JSON-compatible data only, not the broader structured-clone/transfer surface: functions, symbols, non-finite numbers, accessors, sparse arrays, and non-plain objects are rejected. Invalid shapes produce `PROTOCOL_INVALID`; exceeded bounds produce `LIMIT_EXCEEDED`. These are data-validation limits, not bounded-execution or sandbox guarantees for hostile getters/proxies, plugin code, or native work.

## What is hashed

The package configuration emits flat `dist/index.js`, `dist/loader.js`, `dist/plugin-runtime-host.js`, `dist/plugin-runtime-registry.js`, and `dist/plugin-runtime-worker.js` entries. The loader resolves `./plugin-runtime-worker.js` relative to its own installed module. JavaScript splitting is disabled so bundled internal worker/protocol implementation stays inside the worker entry hash rather than an unhashed shared implementation chunk. Node built-ins are external and are not covered by that hash. The CLI entry and SQL migration-copy hook remain unchanged.

The plugin-root digest walks the complete real directory recursively. At each directory, entries are sorted using `name.localeCompare`; symlinks and special files are rejected. For each regular file in that traversal order, the running SHA-256 receives:

```text
UTF-8 relative path with / separators
NUL byte
hex SHA-256 of the file bytes
NUL byte
```

The final SHA-256 hex is `installedPluginDigest`. Relative file names and every regular file's bytes participate, not just discovered plugin entry files. Acceptance output and import markers must remain outside the closed root. The acceptance transaction freezes both worker hash and fixture digest, then rechecks both immediately before manifest issuance and final output without refreshing the expected values.

This digest does not establish that arbitrary imports or native dependencies form a closed executable dependency graph. It does not hash external Node built-ins, OS libraries, native ABI state, or files resolved outside the root. Qualifying such dependencies requires separate evidence; the supplied fixture makes no such claim.

## Run installed-package acceptance

From the matching source/test checkout in the isolated environment, with its recorded test dependencies already available:

```sh
PLUGIN_PACKAGE_ROOT=/absolute/path/to/extracted/package \
PLUGIN_ACCEPTANCE_OUTPUT=/absolute/path/to/fresh/plugin-runtime-acceptance.json \
node --import tsx --import ./test/setup/inject-require.mjs --test \
  test/e2e/plugin-runtime-package.test.ts \
  test/mcp-builder/plugin-runtime-diagnostics.test.ts
```

`PLUGIN_PACKAGE_ROOT` must identify the actual extracted tarball bytes, not source-transpiled replacement modules. `PLUGIN_ACCEPTANCE_OUTPUT` must be a nonexistent path outside the closed fixture root. Existing output is rejected rather than treated as success. Without `PLUGIN_PACKAGE_ROOT`, only prequalification contracts run; that is not installed-package acceptance.

The transaction checks the emitted entries before imports, then uses the installed production host factory and loader/registry without injection seams. Its checks cover retained state, empty worker environment/arguments, raw stdout isolation from actual parent stdout, hung-import exit-before-rejection ordering, bounded diagnostics, missing evidence, all five schema-valid tuple mismatches, and matching admission. Only after all checks succeed does it write `plugin-runtime-acceptance/v1` JSON containing the observed tuple and limited scope.

The retained harness uses actual tarball bytes with cached dependencies and retained older build outputs. It is **not a clean installation or clean-output reproducibility test**, install-script certification, native-dependency qualification, or an ABI/OS/architecture matrix. The passing result applies only to the recorded fixture, bytes, dependency environment, and tested Node/platform/architecture; it does not establish that every file in the package was produced by this build.

## Observed qualification: 2026-09-09

The isolated installed/combined suite passed **71 of 71 tests across 13 suites**, with no failures, skips, or cancellations (`1411.646067 ms`). Build, offline pack/extraction, and independent TypeScript checking each exited `0`. The environment used Node `22.23.2`, Linux `x64`, and TypeScript `5.9.3`; 27 proof-input hashes matched before and after, with no mounts or networks. These are the parent-owned isolated execution results, not a full-project or formal SDD approval.

| Evidence | Recorded value |
|---|---|
| Observed artifact | `test/e2e/results/plugin-runtime-acceptance.json` |
| Artifact SHA-256 | `44be3dbe4751396e6683bfcc4fb12e4c3ad5fa0a5b14a591b2f4241dca2cf337` |
| Actual tarball SHA-256 | `91824240eae7ed8cc46a3cddffd9f618c4a277c5c3b9feacf3671dbc4c4653a7` |
| Worker-entry SHA-256 | `979373c018254c1e3c0dafbc1385e6c0e92a24d90e12ebd788147eec71ebafe9` |
| Built-in-only fixture digest | `0aa8f08703f22afcc73875bf734bc5d2967d3d1fdc70adb7dd2af05ab4d02df9` |
| Detailed execution/log record | `openspec/changes/plugin-runtime-cancellation/apply-progress.md`, Unit 4 Completion |

The JSON was emitted only after raw qualification and fail-closed/matching installed admission completed in the same guarded transaction. It records a temporary built-in-only closed fixture root, not a production compatibility manifest. Do not copy its tuple into production configuration.

## Lifecycle and diagnostic limits

| Boundary | Contract and limitation |
|---|---|
| Import timeout | Requests worker termination; startup rejects with `IMPORT_TIMEOUT` only after the real worker `exit` is observed. An intermediate worker error is not exit acknowledgement. This is not a hard wall-clock deadline. |
| Invocation timeout | Rejects the affected request with `INVOCATION_TIMEOUT`; late results are ignored. It does **not** stop the plugin's operation or terminate the worker. Side effects may continue. |
| Admission | One successful ownership handoff to the registry. Rejected admission awaits cleanup and must not close already admitted healthy plugin siblings. |
| Quarantine | A terminated plugin worker becomes unavailable to all tools sharing it. Separate healthy plugin workers remain independent. There is no automatic restart or replay. |
| Diagnostics | At most **8 KiB UTF-8 per event** and **64 KiB total per worker lifetime across stdout and stderr combined**. Each stream retains its own emitted/dropped-byte counters. |
| Exhausted diagnostic budget | Continue draining and counting dropped bytes; a stream may emit zero diagnostic callbacks after the shared budget is exhausted. Raw worker stdout/stderr must not be forwarded to MCP stdout. |
| Shutdown | Registry-owned cleanup is idempotent; startup/connect failure and normal server shutdown await owned runtime cleanup. Managed worker listeners and request timers are removed at terminal exit. |

Worker isolation is not an OS sandbox or a hard CPU/memory quota. Worker exit does not prove cancellation of native I/O, descendant processes, or previously initiated external work. Timeouts and shutdown do not roll back files, network requests, database writes, or other side effects. Deleting or disabling plugin configuration does not undo effects already produced. Evaluate those risks separately before enabling dynamic plugins.

## Deployment evidence checklist

- [ ] Actual package entries built, packed, and inspected without replacing installed runtime modules.
- [ ] Qualification command exited successfully and produced fresh observed JSON only after its final assertions.
- [ ] Artifact scope, exact runtime details, tarball hash, worker hash, and closed-root digest retained together.
- [ ] Deployment root and worker bytes independently qualified; no temporary-fixture tuple reused for production plugins.
- [ ] Environment allowlist reviewed and timeout/cleanup limitations accepted.

The checklist above is deployment-specific; the recorded fixture result does not check off your deployment obligations.

## Rollout and rollback

Ship worker support disabled by default. Enable it only for an independently qualified deployment tuple. To roll back worker selection, explicitly set `MCP_PLUGIN_RUNTIME_MODE=legacy`; to disable dynamic plugin loading, remove `MCP_DYNAMIC_SERVERS=true`. Apply configuration changes through an orderly shutdown/restart so existing registry-owned workers are closed; changing configuration alone does not terminate already running workers. An explicit worker request never silently falls back to legacy.

Rollback changes future loading behavior only. It does not undo previously produced effects, cancel native I/O or descendant processes, or restore external state. Legacy mode does not provide the worker-mode guarantees.

Next: formal SDD verification and archive remain pending. Independently qualify each actual deployment root before enabling worker mode.
