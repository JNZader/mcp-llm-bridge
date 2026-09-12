# Implementation Handoff — WP-00 Containment and Evidence Harness

OpenSpec is the current artifact authority: `openspec/changes/containment-and-evidence-harness/`. This handoff is a cumulative historical evidence record, not apply/verify approval and not delivery authority.

## Candidate and delivery context

- Change: `containment-and-evidence-harness`
- Baseline/authority commit: `f1ad14f6ae8037a52c705838f4bf1d2b9bac766b`
- Worktree: `/home/javier/programacion/mcp-llm-bridge-wt-wp00`
- Branch: `feat/wp00-containment-evidence`
- Mode: Standard Mode; `strict_tdd:false` (no Strict TDD claim).
- Exact root test command: `node --import tsx --import ./test/setup/inject-require.mjs --test test/*.test.ts test/**/*.test.ts`
- Delivery: user-approved `ask-on-risk` resolved as unchained `size:exception`; no chain strategy. This does not grant review, RDD, commit, push, PR, release, or delivery authority.
- Fresh gate state: SAFE-CORE and SCAN-BIN are checked implementation units; SCAN-BIN was independently admitted at sha256:919c0d3062ea4bc26f23f538af593f90b534ea47ba4e2dc5297a3bfc69e65071 and native independent-gate settlement is complete. SCAN-BIN successors may now route in DAG order. This is not RDD, review, or delivery authority.

## Exact staged/unstaged boundary

Observed current Git state (historical snapshot for this handoff):

- Staged additions (six files; 334 additions, 0 deletions): `src/core/safe-error.ts`, `src/core/safe-operation.ts`, `src/core/safe-telemetry.ts`, `test/contracts/outward-scanner.mjs`, `test/wp00/safe-core.test.ts`, and the staged portion of `test/wp00/scan-bin.test.ts`.
- Mixed file: `test/wp00/scan-bin.test.ts` is `AM`; its staged portion is the corrected SCAN-BIN index and its unstaged portion is the manual correction below.
- Unstaged correction: `test/wp00/scan-bin.test.ts` — 50 additions, 35 deletions, 85 changed lines measured against the corrected 155-addition index.
- `test/contracts/outward-scanner.mjs` has zero manual unstaged changes.
- The exact intended OpenSpec inventory is nine documents: proposal.md, specs/default-deny-containment/spec.md, design.md, design/scenarios-dag.md, design/contracts.md, design/baseline-ledger.md, design/execution-manifest.md, tasks.md, and implementation-handoff.md. This bounded inventory does not imply that no other untracked paths exist outside the OpenSpec change directory; `.tmp-test` is absent.
- No package or lockfile changes are part of this candidate.

## Candidate identity preservation

The before/after OpenSpec write boundary is unchanged: six staged code additions (334/0), one mixed `AM` SCAN-BIN file, and the corrected unstaged rewrite (50/35). The post-write status contains the same code identities plus the nine-document OpenSpec inventory; no code, tests, package files, index entries, or modes were staged or unstaged by this phase.

## Cumulative evidence

### SAFE-CORE (complete implementation unit)

- Creates fail-closed operational errors, a stable HTTP-safe adapter, non-sensitive operation outcomes, and an explicit metadata-only telemetry payload.
- Changed paths: `src/core/safe-error.ts`, `src/core/safe-operation.ts`, `src/core/safe-telemetry.ts`, `test/wp00/safe-core.test.ts`.
- Focused test: `node --import tsx --import ./test/setup/inject-require.mjs --test test/wp00/safe-core.test.ts` — exit 0; 4 passed, 0 failed.
- Proportional typecheck: `pnpm run typecheck` — exit 0.
- Runtime harness: N/A — pure core module; deterministic focused tests exercise public projections and closed telemetry shape.
- Rollback boundary: remove the four SAFE-CORE paths only; no existing consumer or unrelated behavior changes.
- SAFE-CORE diff: 179 additions, 0 deletions, 179 total (native ceiling 270).
- Scope/secret check: only SAFE-CORE ownership paths changed; `git diff --check` passed; no secret matches or package/lockfile drift.

### SCAN-BIN (implementation plus manual remediation)

- Creates deterministic `paths.bin` codec, canonical JSON serializer, SHA-256 artifact identity, and separate provider binding identity.
- Changed paths: `test/contracts/outward-scanner.mjs`, `test/wp00/scan-bin.test.ts`.
- Historical initial SCAN-BIN launch: 150 additions, 0 deletions, 150 total (native ceiling 330). The corrected current index is 155 additions total: 109 in `test/contracts/outward-scanner.mjs` and 46 in `test/wp00/scan-bin.test.ts`.
- Correction addressed SCAN-BIN-G1 through G4: object-scoped duplicate-key parsing, RFC 8785 short control escapes, pre-encoding Unicode scalar validation, and expanded focused vectors.
- Corrected SCAN-BIN delta relative to the staged launch candidate: `test/contracts/outward-scanner.mjs` 12 additions/9 deletions and `test/wp00/scan-bin.test.ts` 3 additions/1 deletion; 15 additions, 10 deletions, 25 changed lines.
- Manual test rewrite is separately measured as `test/wp00/scan-bin.test.ts` 50 additions/35 deletions (85 lines) in the unstaged boundary above.
- Focused test: `node --import tsx --import ./test/setup/inject-require.mjs --test test/wp00/scan-bin.test.ts` — exit 0; 14 explicit SCAN-BIN-01..14 subtests passed, 0 failed.
- Typecheck: `pnpm run typecheck` — exit 0.
- Scoped hygiene: `git diff --check` — exit 0; secret-keyword scan found no matches.
- Evidence hash: `sha256:7a3dd3695aa2cb181428b38a646f82e26adc257bfc8b8a9ce3803b707043dfcb` (historical manual SCAN-BIN evidence). #20398 retained no exact preimage/reproduction command; at that historical stage it was not independently reproducible and could not constitute fresh approval. The later independent admission is recorded below.
- Runtime harness: N/A — codecs and identities only; repository scanning and container integration belong to dependent SCAN-ROOT/HERMETIC units.
- Rollback boundary: revert only manual unstaged `test/wp00/scan-bin.test.ts` changes for the correction; do not disturb staged SAFE-CORE/SCAN-BIN changes.

## Gate and dependency status

- Historical automatic gates 1 and 2 failed; G1–G3 fixes are present and G4 caused the terminal second failure. The manual cycle was remediation evidence only.
- The independent validator admitted the exact candidate revision sha256:919c0d3062ea4bc26f23f538af593f90b534ea47ba4e2dc5297a3bfc69e65071 after focused 14/14, typecheck, and cached diff checks passed; native independent-gate settlement is complete.
- SCAN-ROOT remains responsible for repository inventory and symlink-target containment; SCAN-BIN DAG dependents may now route according to the validated DAG.
- Admission is not RDD, review, or delivery authority; candidate-bound review remains outside this handoff.

## Required next action

AUTH-RUNTIME is admitted and checked. Continue only with the reconciled 68-unit/139-edge/16-wave graph; the whole-root evidence remains owned by HERM-RUNNER/CI-ROOT. The existing native SCAN-ROOT objective (`implement-and-admit-execution-root-parsers`, max 5 attempts / 330 changed lines) remains unfinished and must not be renamed, reset, or evaded; implementation continuation is blocked until native support explicitly rebinds it to the aggregate decomposition.

## Non-normative provenance

Historical sources: Engram #20398 cumulative apply progress/manual SCAN-BIN remediation, #20289 task authority, #20343 delivery decision, and #20476 OpenSpec design gate. OpenSpec files and linked design companions are normative.

## Fresh Gate Preparation - SCAN-BIN-FRESH-GATE-PREP-01

This entry is a cumulative evidence merge. It preserves the historical initial/correction/manual-remediation records above while replacing their pre-staging boundary as the **current** candidate state. It records the pre-admission execution evidence; independent admission is recorded below.

### Current exact candidate boundary

- The former manual rewrite is now staged. The current index contains exactly six added implementation files, **349 additions, 0 deletions**, with no unstaged implementation diff:
  - `src/core/safe-error.ts` - 54 additions
  - `src/core/safe-operation.ts` - 30 additions
  - `src/core/safe-telemetry.ts` - 32 additions
  - `test/contracts/outward-scanner.mjs` - 109 additions
  - `test/wp00/safe-core.test.ts` - 63 additions
  - `test/wp00/scan-bin.test.ts` - 61 additions
- SCAN-BIN-focused staged scope is `test/contracts/outward-scanner.mjs` (109 additions) plus `test/wp00/scan-bin.test.ts` (61 additions), for 170 additions and 0 deletions.
- The nine intended untracked OpenSpec documents remain the only untracked files: `proposal.md`, `specs/default-deny-containment/spec.md`, `design.md`, the four normative `design/*.md` companions, `tasks.md`, and this `implementation-handoff.md`.
- `tasks.md` retains SCAN-BIN as checked; this gate-preparation continuation does not alter task checkboxes or claim fresh approval.

### Executed gate-preparation evidence

| Evidence | Result |
|---|---|
| Focused SCAN-BIN command | `node --import tsx --import ./test/setup/inject-require.mjs --test test/wp00/scan-bin.test.ts` - exit 0; 14 passed, 0 failed; explicit `SCAN-BIN-01` through `SCAN-BIN-14` are present. |
| Proportional typecheck | `pnpm run typecheck` - exit 0. |
| Cached whitespace check | `git diff --cached --check` - exit 0. |
| Bounded hygiene | Staged diff secret-pattern scan found no matches; staged package/lockfile drift check found none. |
| Runtime harness | N/A - SCAN-BIN remains a deterministic codec/identity unit; repository scanning and container integration are owned by SCAN-ROOT and HERMETIC work units. |
| Rollback boundary | Revert only `test/contracts/outward-scanner.mjs` and `test/wp00/scan-bin.test.ts` to remove SCAN-BIN; SAFE-CORE remains independently revertible through its four owned paths. |

### Reproducible candidate identity

- Evidence revision: `sha256:919c0d3062ea4bc26f23f538af593f90b534ea47ba4e2dc5297a3bfc69e65071`.
- Reproduction method (exact byte stream): `LC_ALL=C git diff --cached --binary --no-ext-diff --no-renames HEAD | sha256sum | awk '{print "sha256:" $1}'`.
- Staged blobs: `src/core/safe-error.ts` `b7deed719713136997caf4ec636a6e88992f9b0e`; `src/core/safe-operation.ts` `3ac664ef32f491ded0da5f7e0ca993a6957423e9`; `src/core/safe-telemetry.ts` `ab69e746062d25761ef49942b0436bdabfb1f212`; `test/contracts/outward-scanner.mjs` `23a583f1b32028bfe76f2469d274df4dd4e8ce72`; `test/wp00/safe-core.test.ts` `ead27c743e086e59cd6b8150567362c2008cf9cd`; `test/wp00/scan-bin.test.ts` `a42b49eb88d8bb12f72ac22de195337e1d01202b`.

### Admission status

The independent validator admitted the candidate at sha256:919c0d3062ea4bc26f23f538af593f90b534ea47ba4e2dc5297a3bfc69e65071; focused 14/14, typecheck, and cached diff checks passed, staged blobs and boundary were unchanged, and native independent-gate settlement is complete. This admission is not RDD, review, or delivery authority. SCAN-BIN DAG dependents may now be routed in validated DAG order; SCAN-ROOT retains inventory and symlink-containment ownership.

## AUTH-RUNTIME Historical Partial Evidence — 2026-09-04

- Historical pre-admission status: `2.1 AUTH-RUNTIME` was unchecked while the legacy root command remained incomplete. The current admitted status is recorded below.
- Implemented staged scope: `src/auth/runtime.ts`, `src/core/config.ts`, `src/core/types.ts`, and `test/wp00/auth-runtime.test.ts` (288 additions, 2 deletions; 290 changed lines, the native ceiling).
- RED evidence: before production implementation, `node --import tsx --import ./test/setup/inject-require.mjs --test test/wp00/auth-runtime.test.ts` exited 1 because `src/auth/runtime.js` was absent.
- Focused GREEN evidence: the same command exited 0; 3/3 AUTH-RUNTIME tests passed. They prove absent/incomplete admin/OAuth configuration remains unavailable/denied, public views omit static/OAuth secrets, cookie credentials take precedence, explicit complete configuration remains represented, and invalid/disallowed identities are denied.
- Typecheck: `pnpm run typecheck` exited 0. Cached whitespace check passed. No staged package/lockfile drift or bounded secret-pattern match was found.
- Required root command: `node --import tsx --import ./test/setup/inject-require.mjs --test test/*.test.ts test/**/*.test.ts` (via `pnpm test`) exited nonzero before AUTH-RUNTIME assertions could establish a full-suite result because the worktree lacks the `better-sqlite3` native binding for Node `v25.8.1`. No dependency installation was attempted.
- Runtime harness: N/A for this unit; it is an unbound in-process auth/config contract. HTTP binding, OAuth exchange, CSRF storage, and container harness execution belong to later AUTH-BIND-CORS, AUTH-OAUTH, AUTH-CSRF, and HERMETIC units.
- Rollback boundary: unstage/remove only the four AUTH-RUNTIME paths; retain the six SAFE-CORE/SCAN-BIN paths and their admitted `sha256:919c0d3062ea4bc26f23f538af593f90b534ea47ba4e2dc5297a3bfc69e65071` evidence.

## Approved 2026-09-04 AUTH and root-suite reconciliation

- Historical pre-admission reconciliation: AUTH-RUNTIME was then partial and unchecked at a prior staged tree. The current admitted candidate and scoped evidence are recorded below.
- [executed] Under Node 22.23.2 / pnpm 9.15.9, the focused AUTH behavior test passed 3/3. This is the upcoming scoped AUTH gate together with applicable scanner/hygiene evidence and proportional root typecheck; it is not a claim that AUTH is complete.
- [executed] A Node 22 frozen install and better-sqlite3 load succeeded in disposable-container attempts while source remained immutable.
- [executed] Global-root attempt 1 (sha256:2b94129ecea1dd45ed449b9904a283bef13e8cb3b9b32ed24f16feef6d3ed8cd): read-only source-root run ended 2174 passed, 43 failed, 3 cancelled, 2 skipped because tests require repository-relative writable runtime paths.
- [executed] Global-root attempt 2 (sha256:4d850fa5302920af2af53a5e5b1c1b459df3f493a45cf16da6a5a4e2d71828b9): recursive Bash globstar duplicated root files and hung shared-resource workers; this evidence is invalidated.
- [executed] Global-root attempt 3 (sha256:def4f488e2bf0086a5d55d96ebbeb61a85d4ab2b5cf74f57e8b4a6a3a45aaf0b): corrected normal /bin/sh expansion selected 152 unique paths, but the uncapped root suite timed out at 30 minutes with http-comparison and security-enforcer workers active.
- [read] Static diagnosis: test/http-comparison.test.ts contains unbounded listen/request/server-close waits; test/security-enforcer.test.ts visibly destroys created enforcers; RateLimiter timers are unref'd. [inferred] The highest-ranked explanation is uncapped 152-file worker/resource pressure; no intrinsic timer leak is proven.
- Native reset at ledger revision sha256:535b97ed725c846117fdcf92ec6e37fdb77823ecec703310d614619c454cba2e authorized this documentation reconciliation only; it is not approval evidence. The exact root command remains mandatory for WP-00 and is blocked later on HERM-RUNNER/CI-ROOT runner remediation. The planned developer-container files do not yet exist and do not change this candidate.

## AUTH-RUNTIME Admitted Completion — 2026-09-04

- Status: **admitted and checked**. Native settlement for `AUTH-RUNTIME-01` is complete.
- Final staged scope: `src/auth/runtime.ts`, `src/core/config.ts`, `src/core/types.ts`, and `test/wp00/auth-runtime.test.ts`.
- Real fixes: programmatic static tokens enforce the shared 32-character minimum; Bearer scheme parsing is case-insensitive with valid HTTP whitespace; the focused configuration/runtime matrix covers fail-closed static/OAuth behavior, cookie precedence, malformed credentials, explicit `ADMIN_TOKEN` precedence/no fallback, secret-free public projection, and typed table rows.
- Final candidate: staged tree `549ab2c25561b3a29eee6c2431446ab964549c5d`; staged binary diff `sha256:26101e9560d5b5e3f71b18ce4adac218492e76a7d2211506da55a8b02583bae8`; 285 additions and 2 deletions (287 changed lines, within the 290-line ceiling); no unstaged implementation diff.
- Final scoped evidence: Node `22.23.2`, pnpm `9.15.9`, frozen install, and direct `better-sqlite3` probe passed. The network-disabled focused AUTH command passed 3/3; host and isolated `pnpm run typecheck` passed; staged whitespace, secret-pattern, and package/lockfile checks passed.
- Evidence revision: `sha256:d2081456df45ebe7d9cf23a3ed1a9e0346a025710b1d89c35317caed86626a14`, remediating `sha256:db5467274bb50320ceef1fab041179a18a42171b73ba368c92eeb4e7e47abbe2`.
- Rollback boundary: revert only the four AUTH-RUNTIME paths; retain independently admitted SAFE-CORE and SCAN-BIN paths.
- The whole-root suite was not run here. Its evidence remains unresolved and is exclusively owned by HERM-RUNNER/CI-ROOT.
## Approved SCAN-ROOT decomposition reconciliation — 2026-09-04

The current plan expands the historical 61-unit/127-edge snapshot to **68 units, 139 unique acyclic edges, and 16 topological waves**, preserving all eight checked units and the approved unchained `size:exception` delivery decision. The seven new prerequisite units are `SCAN-ROOT-API`, `SCAN-ROOT-INVENTORY`, `SCAN-ROOT-PACKAGE`, `SCAN-ROOT-SHELL`, `SCAN-ROOT-ACTIONS`, `SCAN-ROOT-DOCKER`, and `SCAN-ROOT-COMPOSE`; the aggregate `SCAN-ROOT` row is retained. `SCAN-ROOT-API` is the first new ready unit (W02), followed by the six grammar/inventory parser units (W03), then aggregate `SCAN-ROOT` (W04).

The task checklist is authoritative at 68 rows: 8 checked and 60 pending. Existing 61-unit counts in earlier handoff entries are historical snapshots and remain preserved. Scenario IDs and normative design/contracts/manifest text are unchanged. No source/runtime/test/native lifecycle/review/commit operation was performed by this reconciliation.
