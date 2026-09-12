# Diagnostics delivery-slice inventory

This document inventories and records fresh functional verification for the smallest coherent candidate for the additive dynamic-plugin diagnostics view. It is not an implementation or delivery authorization. The candidate is locally committed as `ee9e7d257126c2e7dc6498bb171d952597ba6b56` (`feat(plugins): expose privacy-safe dynamic plugin diagnostics`), not published; remote merge was not inspected. WP00 remains open.

## Decision first

**Inventory and independence status: completed.** The diagnostics behavior was verified as a selective overlay on `HEAD` `87ecd7836a47751794f66e814d42f4b52e9aa120`, despite unrelated plugin-runtime changes in the same two shared server files. This fresh six-case receipt is separate from the historical 23-case handoff.

The candidate's behavior is deliberately narrow:

- project `enabled` and the number of loaded entries;
- counts for the closed diagnostic-code allowlist, with every unrecognized code normalized to `unknown`;
- `Object.hasOwn` membership checks so prototype-named input codes do not become recognized codes;
- no reads or output of raw plugin identity, path, tool name, or message fields;
- detached output while `getDynamicPluginLoadSummary()` remains the detailed legacy view;
- no change to functional MCP tool names and no new HTTP, npm/package, scanner-issuer, signer, or supply-chain authorization surface.

This is a privacy projection, not scanner-issued identity mapping. Do not merge a future scanner opaque-ID requirement with internal registry filenames, collision keys, RPC UUIDs, or other routing identifiers.

## Exact candidate boundary

### Files included in full

| Path | Current identity | Git/size facts | Role |
|---|---|---|---|
| `src/server/plugin-diagnostics.ts` | SHA-256 `434fcb5b46244215f4e6ded9e5b6601698d9407d6c538fa6558530a330344bcf` | 95 lines, 3,279 bytes, POSIX mode `0664`; absent from `HEAD` | Pure allowlist/count projection and public diagnostic types. |
| `test/wp00/plugin-diagnostics.test.ts` | SHA-256 `bff0639fe749487bda50b25f2d34bb41c3ed981bdd6b9463e3ec09f0ce2acbf6` | 153 lines, 4,770 bytes, POSIX mode `0664`; absent from `HEAD` | Six named cases covering defaults/legacy compatibility, counts, unknown normalization, prototype names, hostile getters, and detachment. |
| `docs/plugin-diagnostics.md` | SHA-256 `96dc8806ed59916863ec77f1fe8b9a346fdbb7835deb92b923196cc6151170ef` | 44 lines, 2,128 bytes, POSIX mode `0664`; absent from `HEAD` | User-visible contract and identity/authorization boundary. |

The three new regular files have no executable bit. If committed, Git should record them as regular `100644` paths; the current `0664` worktree mode is recorded here only as current filesystem state.

### Shared-file hunks included selectively

The candidate must take only these diagnostics hunks from the dirty shared files:

| Path | Required hunk from current tree | Current identity / `HEAD` identity | Candidate delta |
|---|---|---|---|
| `src/server/mcp-server.ts` | Add the `plugin-diagnostics` import at current line 26; add `getDynamicPluginDiagnostics()` documentation/function at current lines 272–279. | Current SHA-256 `f22b960e700e3e1c93a1b855265601fb174e07d53232b75676ee4a14450e95ae`; `HEAD` Git blob `44fff39b30a84be55f088261fb40f87f74dfe5d4`, both Git mode `100644` (current POSIX `0664`). | 9 additions, 0 deletions when applied to `HEAD`; no runtime-loader or registry hunk. |
| `src/server/mcp.ts` | Add the imported `getDynamicPluginDiagnostics` name at current line 24; replace the named export line at current line 35; add the diagnostic type export at current line 36. | Current SHA-256 `c87683c5cc97f95b8aca915ff73c93968b5add20183de5b95bd41748333968bf`; `HEAD` Git blob `a96271bc96b29bffecfdad45626cbabcc6a648d0`, both Git mode `100644` (current POSIX `0664`). | 3 additions and 1 deletion when applied to `HEAD`. |

The **measured selective candidate delta** is **304 additions and 1 deletion**: 95 + 153 + 44 new-file lines, plus 9/0 and 3/1 selected shared-file deltas. The isolated Git diff contains exactly these five paths; the reusable patch is `/tmp/plugin-diagnostics-slice-verify-BPNXcE/exactcandidate.patch`, SHA-256 `5134e0190f021280fba65eddc16a8e7b7322a54b53586ce7d5c2449404bc37b9`, and it applies cleanly to a separate `HEAD` scratch snapshot. The current whole-tree tracked diff is **626 additions and 124 deletions across 20 tracked files**, which must not be attributed to diagnostics.

### Explicitly excluded runtime hunks

Do not include the current plugin-runtime work that happens to share these files:

- `src/server/mcp-server.ts` import changes for `pluginRuntimeConfig`, `loadWorkerPlugins`, and `createPluginRuntimeRegistry` (current lines 17, 22, and 24), the `pluginRuntimeRegistry` option (line 66), `workerProxy` admission changes (lines 183 and 230–234), option destructuring (line 292), and the worker/registry startup, close, and error-boundary block (lines 376–450).
- The current `src/mcp-builder/plugin-runtime-registry.ts` (130 lines, SHA-256 `c2c5b312026b4d179d45d70fafbb78ea4f6cf8e063e7f6a06f0dcc0466c5dc3`) and the loader/runtime changes it consumes. These are a separate runtime work unit, not diagnostics prerequisites.
- Current `src/mcp-builder/loader.ts`, `src/mcp-builder/adapter.ts`, bootstrap/config files, runtime tests, fixtures, OpenSpec files, and unrelated audit changes.

The full current `src/server/mcp-server.ts` diff is 94 additions/44 deletions and the full current `src/server/mcp.ts` diff is 3 additions/1 deletion. Only the selected diagnostic additions above belong to this inventory; whole-file allowlisting would falsely absorb the runtime changes.

## Dependency and independence conclusion

`src/server/plugin-diagnostics.ts` has no imports and its projection logic is locally self-contained. However, `test/wp00/plugin-diagnostics.test.ts` imports `src/server/mcp.ts` for the accessor and legacy-summary assertion. The current `mcp.ts` imports `mcp-server.ts`, and the current `mcp-server.ts` imports the dirty loader/runtime registry chain. Therefore:

1. **Source-coherent selective candidate:** verified from the pure module and the two explicit export/accessor hunks; applying only those hunks to `HEAD` avoids the runtime chain.
2. **Candidate independence:** verified in an isolated `HEAD` plus five-overlay snapshot. The shared dirty worktree and its runtime files were not used as snapshot dependencies.
3. **Delivery limitation:** this evidence proves only the stated candidate gates. It does not establish publication, review PASS, whole-product behavior, or a populated runtime accessor path.

This is not a claim that the diagnostics feature is absent. It is present in the dirty tree, and its independent delivery boundary is now functionally evidenced.

## Historical proof and limits

The retained handoff records **23/23 disjoint named Node 22.23.2 cases**: diagnostics 6, loader 11, and registry 6, plus `tsc --noEmit` exit 0. The recorded snapshot is SHA-256 `15805fcc3e8a2d82341dc829dd18a3a0b0296ee91707b439d5baa2335322650b`; retained log hashes are diagnostics `c0609e87834f241a1e5b3a1ef690db2fe521b4a6148c02a86754fc29ef0e3fe7`, loader `1bd8940a01ab119ed24ca07875c7e3370ab8327099aa856237090642dea56b59`, registry `b50d33d7995e3bbe82b5bf8eb9e1962ae4843099a38a6c06fc7d7d830a41aeb5`, and the typecheck log is empty-hash. The host snapshot was retained at `/tmp/.diagnostics-node22-20260909-153424` with container counterpart `/work/.diagnostics-node22-20260909-153424`.

That proof is historical/read evidence, not a test execution in this inventory. It exercised a dirty host snapshot containing runtime work; it does not prove candidate independence, fresh tests, whole-product behavior, Node 25 qualification, clean install, build output, package publication, HTTP exposure, scanner-issued IDs, or supply-chain authorization. The retained logs must be labeled **READ**, never new **EXECUTED** evidence.

## Fresh isolated candidate receipt

The fresh snapshot used `HEAD` `87ecd7836a47751794f66e814d42f4b52e9aa120` plus only the five candidate overlays. It ran in the approved cached offline Node `22.23.2` container with no mounts or attached networks; host evidence is retained under `/tmp/plugin-diagnostics-slice-verify-BPNXcE` and container evidence under `/work/.plugin-diagnostics-slice-verify-BPNXcE`.

| Overlay | Snapshot SHA-256 | Boundary note |
|---|---|---|
| `src/server/plugin-diagnostics.ts` | `434fcb5b46244215f4e6ded9e5b6601698d9407d6c538fa6558530a330344bcf` | New file. |
| `test/wp00/plugin-diagnostics.test.ts` | `bff0639fe749487bda50b25f2d34bb41c3ed981bdd6b9463e3ec09f0ce2acbf6` | New file. |
| `docs/plugin-diagnostics.md` | `96dc8806ed59916863ec77f1fe8b9a346fdbb7835deb92b923196cc6151170ef` | New file; not changed by this follow-up. |
| `src/server/mcp-server.ts` | `7928ccfd19d3264f6b1b0fc5b10e8b84f17288f4d39e6aecb03ce579682b056a` | Selective diagnostics-only overlay; intentionally differs from dirty whole-file SHA-256 `f22b960e700e3e1c93a1b855265601fb174e07d53232b75676ee4a14450e95ae`. |
| `src/server/mcp.ts` | `c87683c5cc97f95b8aca915ff73c93968b5add20183de5b95bd41748333968bf` | Its whole current diff is diagnostics-only. |

`node --import tsx --test test/wp00/plugin-diagnostics.test.ts` exited `0` with **6/6** named cases; its log is `/tmp/plugin-diagnostics-slice-verify-BPNXcE/logs/plugin-diagnostics.node22.log`, SHA-256 `27c3c5d94af6a04683a3d444192c87a458e82f4e1cab67d1a2e6092a946f5232`. Cached `/work/node_modules/.bin/tsc --noEmit` also exited `0` with empty output at `/tmp/plugin-diagnostics-slice-verify-BPNXcE/logs/typecheck.node22.log`, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Exit records are retained in the same `logs/` directory. The full repository pre/post manifests are byte-identical, each SHA-256 `c517d4e4de60941f38c7bfbc3f1abdf3a46e6458e7cc361153818c922b8cd2fe`; HEAD and index were unchanged, with no staged change.

Coverage is deliberately limited: the six cases prove the default in-process accessor and legacy summary compatibility, plus direct aggregation behavior for fixed counts, unknown/prototype inputs, hostile getters, and detached output. They do **not** prove a populated runtime accessor path or functional MCP tool-name runtime behavior. No HTTP route, npm/package export, scanner-issued identity, authentication, authorization, or supply-chain claim follows.

## Delivery story and rollback

### Completed local commit

The completed local commit is `ee9e7d257126c2e7dc6498bb171d952597ba6b56`, parent `87ecd7836a47751794f66e814d42f4b52e9aa120`, subject `feat(plugins): expose privacy-safe dynamic plugin diagnostics`. It contains the exact five-path, **304 additions / 1 deletion** candidate established by the historical selective patch.

`/tmp/diagnostics-scoped-commit-5gm1jlww/post-commit-proof.json` records that all committed blobs match the candidate; tracked and untracked contents/modes were unchanged; the index is empty; shared hooks are identical; and `commit-msg` was observed while `pre-commit` was not invoked. The explicit one-time pre-commit skip is spent. It used a temporary `git -c` hooks directory and made no permanent hook or configuration change. No push or build occurred.

### Rollback boundary

Rollback removes the three new files and reverts only the diagnostic import/accessor/export hunks in `src/server/mcp-server.ts` and `src/server/mcp.ts`. It must leave the gateway commit `87ecd7836a47751794f66e814d42f4b52e9aa120`, plugin-runtime files, audit/OpenSpec documents, and all unrelated work untouched.

### Local delivery state

The candidate is **locally committed** as `ee9e7d257126c2e7dc6498bb171d952597ba6b56`, not published, and not a WP00 closure. Remote merge was not inspected. The gateway fix remains the prior local commit `87ecd78`; the TCP preparation remains paused. RDD is off. No review PASS, npm release, deployment, or production readiness is implied. The remaining plugin-runtime changes (85 additions / 44 deletions) are unstaged and separate; the dirty whole-file `src/server/mcp-server.ts` SHA-256 remains `f22b960e700e3e1c93a1b855265601fb174e07d53232b75676ee4a14450e95ae`.

## Alternatives and trade-offs

| Option | Benefit | Trade-off |
|---|---|---|
| Deliver this privacy projection as a bounded source-level unit | Small, reviewable behavior; preserves legacy compatibility and prevents raw diagnostic leakage. | It does not provide scanner-issued identities or authorization; its isolated functional proof remains limited to the stated six cases and typecheck. |
| Block diagnostics delivery until scanner issuer/binding is specified | Stronger end-to-end identity/provenance contract. | Larger cross-workstream scope; delays a useful aggregate view and couples it to unresolved scanner acceptance. |

The second option is a product-contract decision, not a reason to invent a signer, trust root, opaque-ID mapping, or native blocking envelope here. The present inventory recommends keeping the privacy projection separate while recording the scanner binding as a prerequisite for any future identity-bearing extension.

## Next action and useful non-executed follow-up

The first diagnostics slice is locally committed. The next uncommitted plugin-runtime group needs a bounded inventory; this document does not create or execute that inventory, authorize implementation, or authorize a push. A useful but **not executed** follow-up would cover a populated runtime accessor path and functional MCP tool-name behavior without adding an HTTP route, npm export, scanner issuer, or authorization claim.

## Evidence anchors

<!-- evidence:begin -->
- [read] The diagnostics implementation is an import-free allowlist/count projection and uses own-property membership for raw codes. src=src/server/plugin-diagnostics.ts:1-95
- [read] The diagnostics tests cover six named cases, including legacy compatibility, unknown/prototype normalization, hostile getters, and detached output. src=test/wp00/plugin-diagnostics.test.ts:17-153
- [read] The legacy summary remains detailed while the diagnostics accessor is documented as in-process and non-MCP/non-HTTP. src=src/server/mcp-server.ts:256-279
- [read] The barrel re-exports the diagnostics accessor and its public types without changing functional tool registration. src=src/server/mcp.ts:20-36
- [read] The current WP00 report labels the 23/23 Node 22 handoff as bounded evidence and disclaims whole-product closure. src=docs/audit/2026-09-01/wp00-progress-current.md:51-62
- [read] The current macro board distinguishes the two local commits from the remaining uncommitted plugin-runtime work and publication state. src=docs/audit/2026-09-01/roadmap-current.md:48-66
- [executed] Read-only worktree state and current branch were inspected. cmd=`git status --short --branch` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] The isolated candidate measured 304 additions/1 deletion and its reusable patch applied to a separate HEAD scratch snapshot. cmd=`git -C /tmp/plugin-diagnostics-slice-verify-BPNXcE/snapshot diff --numstat; git -C /tmp/plugin-diagnostics-slice-verify-BPNXcE/patch-apply apply --check /tmp/plugin-diagnostics-slice-verify-BPNXcE/exactcandidate.patch` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] The six named diagnostics cases passed in the isolated Node 22 snapshot. cmd=`node --import tsx --test test/wp00/plugin-diagnostics.test.ts` exit=0 cwd=`/work/.plugin-diagnostics-slice-verify-BPNXcE/snapshot`
- [executed] Isolated candidate typechecking passed. cmd=`/work/node_modules/.bin/tsc --noEmit` exit=0 cwd=`/work/.plugin-diagnostics-slice-verify-BPNXcE/snapshot`
- [executed] The local commit parent, subject, paths, and numstat were read; retained post-commit proof confirms exact candidate blobs, unchanged repository manifests, empty index, and unchanged shared hooks. cmd=`git show -s --format='%H%n%P%n%s' ee9e7d257126c2e7dc6498bb171d952597ba6b56; git diff-tree --no-commit-id --name-only --numstat -r ee9e7d257126c2e7dc6498bb171d952597ba6b56` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
<!-- evidence:end -->

## Parent handoff

**status:** completed inventory and fresh isolated functional verification.

**executive_summary:** The smallest honest diagnostics work unit is the three new diagnostics files plus 9/0 selected lines in `mcp-server.ts` and 3/1 selected lines in `mcp.ts`; it is now locally committed as `ee9e7d2`. The current shared files also contain separate unstaged plugin-runtime work, so whole-file delivery remains forbidden. Fresh isolated proof is 6/6 named diagnostics cases plus `tsc --noEmit`; historical 23/23 evidence remains separate/read-only.

**artifacts:** `docs/audit/2026-09-01/delivery-slice-plugin-diagnostics.md`; minimal updates to `docs/audit/2026-09-01/roadmap-current.md` and `docs/audit/2026-09-01/wp00-progress-current.md`.

**exact_independence_conclusion:** Proven only for the exact `HEAD` plus five-overlay snapshot and its six diagnostics cases/typecheck. No runtime/type/API fix is proposed.

**risks:** mixed shared-file diff; proof does not cover a populated runtime accessor or functional tool-name runtime behavior; scanner-issued identity and authorization remain unresolved; current worktree is shared and dirty.

**next_recommended:** The next uncommitted plugin-runtime group needs its own bounded inventory. No implementation, staging, commit, push, review, build, provider, or RDD/SDD operation is authorized by this inventory.

**skill_resolution:** paths-injected: `/home/javier/.agents/skills/typescript/SKILL.md`, `/home/javier/.agents/skills/cognitive-doc-design/SKILL.md`, `/home/javier/.agents/skills/evidence-grading/SKILL.md`, `/home/javier/.agents/skills/work-unit-commits/SKILL.md`.
