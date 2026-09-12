# Delivery slice candidate: gateway deleted-CWD handling

**Status:** the first delivery slice is locally committed as `87ecd7836a47751794f66e814d42f4b52e9aa120` (`fix(setup): contain gateway settings path resolution failures`), but is not published and its remote-merge state is unknown. The earlier inventory preparation was docs-only; the later bounded verification is recorded below. Neither event claims review PASS or WP00 closure.

## Decision and delivered local work unit

The smallest first delivery candidate was the gateway project-scope settings-path correction and its isolated regression fixture. Its local Conventional Commit is:

```text
fix(setup): contain gateway settings path resolution failures
```

The candidate was independent at the file/hunk level: every hunk in the three allowlisted files belonged to the deleted-working-directory regression and its harness. No other dirty file was part of this candidate. The local commit contains exactly those paths; it did not include this inventory, roadmap, or WP00 documentation.

## Historical candidate inventory

Base revision: `922e7fd039556f7ed724ce39a20fb693d14c702a` (`docs(plugins): assess cancellable runtime options`).

| Path | Git mode / working-tree mode | Current SHA-256 | Current diff vs base |
|---|---|---|---|
| `src/setup/gateway-setup.ts` | `100644` / `664` | `298d79ec2cc045f1e292d937d88308a562da2912e2f737956facfb9a784a219c` | `1` addition / `1` deletion |
| `test/wp00/log-setup-merge.test.ts` | `100644` / `664` | `dc67c65e48010772f98a6bb6553785b3d89a6c5859e828d62c1f962a67c14a65` | `11` additions / `0` deletions |
| `test/wp00/fixtures/log-setup-merge-child.ts` | `100644` / `664` | `a169ef5c8af83d0f2cfb7989b65be46f8c3a870191f937a6ae2b02e70250a240` | `20` additions / `6` deletions |

At preparation time, the candidate diff was **32 additions, 7 deletions**, three modified paths, with no staged changes. The three file hashes match the previously recorded verified handoff identities; this inventory did not rerun that handoff.

## Current local delivery status

Commit `87ecd7836a47751794f66e814d42f4b52e9aa120` has parent `922e7fd039556f7ed724ce39a20fb693d14c702a`, the title above, exactly the three historical inventory paths, and the same **32 additions / 7 deletions**. Parent post-commit proof is retained at `/tmp/gateway-scoped-commit-vacqczq_/post-commit-proof.json`; it records the exact candidate hashes, no change to tracked or untracked contents/modes, an empty index, unchanged shared hooks, and observed commit-message invocation. The user explicitly authorized omission of only the pre-commit hook for this commit because it builds; a temporary copied hook directory retained the other hooks, and no permanent Git configuration or hook change was made.

## Root cause and behavior

`runSetupGateway()` resolved the project settings path before entering its merge `try` block. For project scope, `resolveSettingsPath()` calls `join(process.cwd(), '.claude', 'settings.json')`. If the current directory is removed between process start and resolution, `process.cwd()` throws before the existing catch boundary, so the setup command escapes instead of returning its documented failure.

The source hunk moves `options.settingsPathOverride ?? resolveSettingsPath(scope)` into the existing `try`. The intended result is:

- return code `1`, `escaped: false`;
- fixed stderr: `[setup-gateway] Unable to update Claude Code settings.`;
- no deleted path, exception text, or stack in the output;
- no settings write, backup, CLI invocation, or gateway runtime startup.

The regression test adds the `removed-cwd` scenario. The child fixture creates and removes a project working directory, invokes `runSetupGateway(['--apply', '--scope', 'project'])` without a path override, and reports the bounded result. Existing Claude/gateway hostile-error, success, dry-run, backup, and helper-identity cases remain in the same fixture.

## Independence and direct dependency boundary

| Boundary | Evidence-bound conclusion |
|---|---|
| Production source | The candidate source imports only Node `fs`, `path`, `os`, and `DEFAULT_HTTP_PORT` from `src/core/constants.ts`; no candidate dependency file is modified. |
| Regression runner | `log-setup-merge.test.ts` launches only the owned child fixture with Node built-ins, a synthetic `HOME`, bounded timeout/maxBuffer, and temporary cleanup. |
| Child fixture | The fixture imports the two setup modules under test and Node built-ins. The new dynamic gateway import occurs before deleting the CWD; the existing Claude path and hostile merge seams remain unchanged in purpose. |
| File/hunk scope | `git diff HEAD` shows only the three allowlisted paths and no unrelated hunk. File-level allowlisting is therefore sufficient for this candidate; no hidden second work unit was inferred. |

This independence is limited to the candidate boundary. The shared worktree contains unrelated dirty source, tests, diagnostics, plugin-runtime, OpenSpec archive, and documentation changes; none are included here.

## Existing functional proof (historical handoff)

The prior independent handoff recorded:

- isolated Node `22.23.2` execution with cached lock-matching dependencies;
- `test/wp00/log-setup-merge.test.ts`: **24/24**;
- `test/setup/gateway-setup.test.ts`: **27/27**;
- `tsc --noEmit`: exit `0`;
- no mounts or network in the private container;
- historical logs: `log-setup-merge.node22.log` SHA-256 `5e1b8922602b849e7f209d200df4ece2ebe536ca9c011ccb2c6424c71e89f3d8`; `gateway-setup.node22.log` SHA-256 `d0571894de6eadb7cb174da100734c1b6941f7dd64a49bccb7162da334d5795d`;
- prior stdout compatibility marker (17 entries): SHA-256 `d7f7d84d88013a94857e3287096631ceb59946462557386c92be02249e3a1f3d`.

The handoff remains historical context rather than the current receipt. The preceding documentation preparation did not run a test, typecheck, build, provider, container, or runtime command; the later fresh verification below did run the stated isolated gates.

## Fresh isolated functional verification (current receipt)

After the docs-only preparation, verification created an isolated snapshot of `HEAD` `922e7fd039556f7ed724ce39a20fb693d14c702a` with only these three candidate overlays. It used the already-running approved offline container `plugin-unit2-final-20260908` (`42cac9c2f14c1778c037df8fa24832102ab8fb8115a1e5c466e52da4d9fe6bbb`), image `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d`, Node `22.23.2`, no mounts, and no attached networks. The snapshot package and lock hashes matched `b38b6f467c303468f5c47caa795ada75d8143fc82380b974760e05edcb380e9b` and `567e8f25a8c60f2a62afaab147d36723029a522cccb54bc3d46b4114e5cdad4f`; all three overlay hashes matched the inventory above and the later local commit. The retained proof remains valid with unchanged bytes; it was not rerun after commit.

| Gate | Result | Retained evidence |
|---|---|---|
| `node --import tsx --test test/wp00/log-setup-merge.test.ts` | exit `0`; **24/24** | `/tmp/gateway-slice-verify-ho1Ce2/container-logs/log-setup-merge.node22.log`; SHA-256 `ec1707f8a4f4ce65abea174ae12401dd148d6ffd30483ad5adfdf99341f638f0` |
| `node --import tsx --test test/setup/gateway-setup.test.ts` | exit `0`; **27/27** | `/tmp/gateway-slice-verify-ho1Ce2/container-logs/gateway-setup.node22.log`; SHA-256 `13d4464cc13122ca8034abf406b3f966969d6d40cdeafe34f7a40495550fd525` |
| `/work/node_modules/.bin/tsc --noEmit` | exit `0`; empty output | `/tmp/gateway-slice-verify-ho1Ce2/container-logs/typecheck.node22.log`; SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The isolated container copies are retained under `/work/.gateway-slice-verify-ho1Ce2`; `gate-exits.txt` records all three zero exits (SHA-256 `e66f0cb15565db2cf547bac42e48e10bb7475f66c6f948dc98d691d1f0f80c1e`) and `log-sha256.txt` is retained with SHA-256 `60ffde2507768d788b9094548680cbb559e808981c1e1f824dd45b027ad726c7`. The repository pre/post manifests are byte-identical (both SHA-256 `7083226d593c648aaf85b911b5a23f33368f0b75e47f83c2a40698b2bf0bc42a`): HEAD, index tree, protected source hashes, candidate diffstat, staged state, and existing unrelated dirty-worktree manifest did not change.

One initial scratch setup command failed before any gate started because container POSIX `sh` did not expand a brace expression and the requested log directory did not exist. It is retained as `/tmp/gateway-slice-verify-ho1Ce2/setup-attempt.txt` (SHA-256 `4e0687a766d05bb116665479fcea01fe2c304b42d6c0cdc422ed9698af7c37d4`). Explicit POSIX directory creation corrected setup; no test failed and no gate was retried.

## Delivery and review boundary

| Item | Current state |
|---|---|
| Implementation | Locally committed in `87ecd7836a47751794f66e814d42f4b52e9aa120` at the historical hashes above. |
| Verification | Fresh isolated functional verification is complete: 24/24 + 27/27 focused cases and `tsc --noEmit` all exited 0. Historical proof remains separate context. |
| Review | No fresh RDD/review lens PASS is claimed; clone RDD remains disabled. |
| Git delivery | The exact three-file slice is locally committed; this documentation update is not part of that commit. |
| Remote delivery | Not published; remote merge state is unknown and no remote API was inspected. |
| WP00 closure | Not claimed; this slice addresses one setup boundary only. |

## Explicit exclusions

Do not include or stage:

- plugin-runtime worker/archive artifacts, `docs/plugin-runtime-cancellation.md`, or plugin-runtime tests;
- additive plugin diagnostics source/tests/docs;
- `openspec/changes/archive/`, canonical SDD tasks/contracts/DAG, or any SDD state;
- `tsup.config.ts`, package/build/provenance files, or scanner ROOT/AST work;
- current macro-roadmap or WP00 report edits as source-delivery files;
- any unrelated dirty source/test/config/documentation path in the shared worktree.

This candidate does not redesign token output, settings atomicity, authentication, TCP, provider routing, plugin identity, scanner admission, or supply-chain authorization. Those remain separate acceptance groups.

## Rollback concept and missing checks

Rollback is bounded to removing the source move and the `removed-cwd` additions/replacements in these three files, restoring the base behavior and fixture without touching unrelated work. No revert was performed.

After the first local commit, the next roadmap delivery group still needs:

1. a bounded inventory for the next separate delivery group, such as diagnostics or plugin work;
2. an explicit authorization before any implementation, staging, push, PR, or remote action for that later group.

RDD remains disabled and no review PASS is implied by this local commit or its functional verification.

<!-- evidence:begin -->
- [read] The gateway source resolves project settings through `process.cwd()`. src=src/setup/gateway-setup.ts:146-155
- [read] The current source places that resolution inside the merge catch boundary. src=src/setup/gateway-setup.ts:302-308
- [read] The regression harness launches the owned child fixture with a synthetic HOME, bounded timeout, and cleanup. src=test/wp00/log-setup-merge.test.ts:22-37
- [read] The new regression asserts fixed code/diagnostic behavior for a removed project working directory. src=test/wp00/log-setup-merge.test.ts:72-81
- [read] The child fixture removes the CWD and invokes project-scoped gateway setup without a path override. src=test/wp00/fixtures/log-setup-merge-child.ts:120-136
- [executed] Candidate identity and diff scope were inspected read-only. cmd=`sha256sum src/setup/gateway-setup.ts test/wp00/log-setup-merge.test.ts test/wp00/fixtures/log-setup-merge-child.ts; git diff --numstat HEAD -- src/setup/gateway-setup.ts test/wp00/log-setup-merge.test.ts test/wp00/fixtures/log-setup-merge-child.ts` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] Base revision and candidate paths were inspected read-only. cmd=`git rev-parse HEAD; git status --short -- src/setup/gateway-setup.ts test/wp00/log-setup-merge.test.ts test/wp00/fixtures/log-setup-merge-child.ts` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] The isolated snapshot identity matched the base package/lock and all three candidate overlay hashes. cmd=`sha256sum package.json pnpm-lock.yaml src/setup/gateway-setup.ts test/wp00/log-setup-merge.test.ts test/wp00/fixtures/log-setup-merge-child.ts` exit=0 cwd=`/work/.gateway-slice-verify-ho1Ce2/snapshot`
- [executed] The focused WP00 regression passed. cmd=`node --import tsx --test test/wp00/log-setup-merge.test.ts` exit=0 cwd=`/work/.gateway-slice-verify-ho1Ce2/snapshot`
- [executed] The focused gateway setup regression passed. cmd=`node --import tsx --test test/setup/gateway-setup.test.ts` exit=0 cwd=`/work/.gateway-slice-verify-ho1Ce2/snapshot`
- [executed] Whole-snapshot typechecking passed. cmd=`/work/node_modules/.bin/tsc --noEmit` exit=0 cwd=`/work/.gateway-slice-verify-ho1Ce2/snapshot`
- [executed] Protected repository state was unchanged by verification. cmd=`cmp -s /tmp/gateway-slice-verify-ho1Ce2/repository-pre.txt /tmp/gateway-slice-verify-ho1Ce2/repository-post.txt` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- [executed] The local commit has the stated parent, subject, exact paths, and diffstat. cmd=`git show -s --format='commit=%H%nparent=%P%nsubject=%s' 87ecd7836a47751794f66e814d42f4b52e9aa120; git diff-tree --no-commit-id --name-status --numstat -r 87ecd7836a47751794f66e814d42f4b52e9aa120` exit=0 cwd=`/home/javier/programacion/mcp-llm-bridge-wt-wp00`
<!-- evidence:end -->

## Next action

The first delivery slice is locally committed and remains unpublished. The next roadmap delivery group needs its own bounded inventory before any implementation or delivery decision; do not stage, push, or expand the committed slice into diagnostics, plugin runtime, scanner, TCP, provenance, or final WP00 work.
