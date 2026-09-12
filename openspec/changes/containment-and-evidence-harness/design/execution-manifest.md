# WP-00 Revision 22 Execution, Publication, and Generated Manifest

> Normative companion to [the architecture design](../design.md). Mandatory reading with the full design set.

Baseline: tracked HEAD `f1ad14f6ae8037a52c705838f4bf1d2b9bac766b`. Commands are proposed and remain unexecuted until implementation.

## 1. Executable-root inventory

Scanner input is `git ls-files -z --cached --others --exclude-standard`, with tracked modes from `git ls-files --stage -z`. It classifies all `.ts,.tsx,.js,.jsx,.mjs,.cjs,.mts,.cts,.sh`, extensionless files, shebang files, mode-100755 files, package scripts/bin/main/module/exports, workflows, Docker/Compose commands, tsup/Vite/TS configs, and generated runtime roots.

Tracked configuration/entry roots:
- `package.json,pnpm-lock.yaml,src/index.ts,tsup.config.ts,tsconfig.json`;
- `dashboard/package.json,dashboard/pnpm-lock.yaml,dashboard/vite.config.ts,dashboard/tsconfig.json,dashboard/tsconfig.app.json,dashboard/tsconfig.node.json`;
- `.github/workflows/ci.yml,.github/workflows/deploy-pages.yml,.github/workflows/docker.yml`;
- `Dockerfile,docker-compose.yml,docker-compose.test.yml,lib/common.sh`;
- `test-pageindex-local.js,test-pageindex-simple.js`;
- every root-test path discovered by the exact predicate below;
- `docs/index.html,docs/assets/index-B4BCwxko.css,docs/assets/index-CUthDRMA.js,docs/favicon.svg,docs/icons.svg`;
- non-dashboard docs `docs/fix-forward-review-2026-05-27.md,docs/github-oauth-setup.md,docs/wiring-sprint-strategy.md` are documentation records, not dashboard build output.

Tracked mode-100755 executable baseline includes `dist-old/index.js,lib/common.sh,test-pageindex-local.js,test-pageindex-simple.js`. All shebang/extensionless files are inspected regardless of mode.

Parser registry is normative from [contracts](contracts.md): TypeScript 5.9.3 with lock integrity `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==`, plus package-json-v1, posix-shell-v1, github-actions-yaml-v1, dockerfile-v1, and compose-yaml-v1. Unsupported execution-affecting grammar fails.

Root scanning is staged: SCAN-ROOT-API defines the closed result/diagnostic contract; SCAN-ROOT-INVENTORY performs Git/untracked inventory, executable classification, special-file rejection, and symlink-target containment; five grammar units parse package JSON, bounded POSIX-shell syntax, Actions YAML, Dockerfile, and Compose; aggregate SCAN-ROOT classifies generated/root/devcontainer records, dispatches every applicable path exactly once, assembles the manifest, and fails unless unparsed execution roots are zero. Each parser receives observed immutable bytes and a separate trusted root-authority argument created only after SCAN-BIN binding admission; it compares observed path/mode/length/SHA-256 with the authoritative record before parsing, then returns only a parsed result or a content-free rejection.

## 2. Publication and generated ownership

Tracked package facts: `files=["dist","README.md"]`; `main="dist/index.js"`; bin `mcp-llm-bridge="dist/index.js"`; `module` absent; `exports` absent. `tsup.config.ts` entry is `src/index.ts`, ESM, dts, and copies `src/migrations/*.sql`. Required graph is `src/index.ts -> temporary dist/index.js -> main+bin -> files`. A missing target, bin without shebang/mode 100755, output outside files, new module/exports, or undeclared archive entry fails.

PUB-OLD deletes, never quarantines, every tracked legacy file:
- `dist-old/chunk-2BDEDDWJ.js`
- `dist-old/chunk-WGKIBMFP.js`
- `dist-old/github-oauth-B7W3VDWK.js`
- `dist-old/index.d.ts`
- `dist-old/index.js`
- `dist-old/mcp-integration-RSUGTUHQ.js`

PUB-BUILD modifies `tsup.config.ts` to accept only an explicit absolute `WP00_BUILD_OUTDIR` under `RUNNER_TEMP`; migrations copy to that same output. `scripts/verify-publication.mjs` builds, emits JCS `test/contracts/publication-manifest.json` with sorted path/mode/length/SHA-256, stages `package.json,README.md,temp-dist`, runs `pnpm pack --dry-run --json`, and verifies exact archive membership. Stale/extraneous/missing/path/mode/byte differences fail and disable publication readiness.

GEN-DASH owns the complete dashboard-generation chain without treating tracked output as source:

| source record (tracked, mode 100644) | temporary Vite output (normalized mode 100644) | tracked generated output (mode 100644) |
|---|---|---|
| `dashboard/public/favicon.svg` | `$RUNNER_TEMP/dashboard-dist/favicon.svg` | `docs/favicon.svg` |
| `dashboard/public/icons.svg` | `$RUNNER_TEMP/dashboard-dist/icons.svg` | `docs/icons.svg` |

Regeneration builds to the temporary directory, requires each SVG temporary byte stream to equal its source byte stream, then atomically updates `docs/index.html`, all `docs/assets/**`, `docs/favicon.svg`, and `docs/icons.svg` from temporary output. Its allowlists are exactly temporary `index.html,assets/**,favicon.svg,icons.svg` and tracked generated `docs/index.html,docs/assets/**,docs/favicon.svg,docs/icons.svg`; missing, extraneous, non-100644, or byte mismatch fails. The verifier reads `dashboard/public/*.svg` as source, temporary output as build product, and `docs/*.svg` as generated destination; it never reverses that relation.

Explicit non-dashboard docs, excluded from both allowlists and never deleted, are `docs/fix-forward-review-2026-05-27.md`, `docs/github-oauth-setup.md`, and `docs/wiring-sprint-strategy.md`. `test/contracts/dashboard-assets.json` version 2 contains all three stages with path, normalized mode, length, SHA-256, and edge relation. GEN-DASH owns source/build/output manifest and regeneration; CI-DASH owns read-only comparison and DASH-CI scenarios; CLAIMS-FINAL depends on CI-DASH and reads the final tracked generated bytes.


## 3. Sole bootstrap guard and root discovery

Create:
- `test/hermetic/bootstrap.mjs` — sole image ENTRYPOINT and sole Node entry;
- `test/hermetic/js-guards.mjs` — imported by bootstrap only after token validation;
- `test/hermetic/loopback-registry.mjs`;
- `test/hermetic/fixture-child.mjs`;
- `test/hermetic/image-preflight.mjs`;
- `test/contracts/outward-scanner.mjs`;
- `scripts/ci-hermetic.sh`;
- `Dockerfile.test`;
- `Dockerfile.test.dockerignore`.

Nothing project-executable, including tsx, inject-require, setup, test files, user preload, or native addon loads before `bootstrap.mjs` validates its inherited-fd admission token and immutable candidate binding and installs JS guards. Bootstrap imports only Node builtins required for validation; then imports `js-guards.mjs`, dynamically registers tsx, imports `test/setup/inject-require.mjs`, and invokes Node 22 `node:test.run({files:[file],concurrency:1,isolation:"process"})` through one admitted per-file child. JS hooks are defense in depth for JS-visible fs/network/process APIs; they do not claim to contain native addons. Native containment is the Docker/OS boundary: network namespace none, immutable read-only image/candidate, tmpfs-only state, non-root UID/GID, minimal image without provider CLIs, no host HOME/executable/node_modules mounts, exact cwd and digest-pinned image.

Discovery reads `paths.bin`. A test is a regular record under `test/` whose basename ends exactly `.test.ts,.test.js,.test.mjs`. Exclude segments `fixtures,helpers,setup,node_modules,snapshots` and exact infrastructure files under `test/hermetic/`. Sort unsigned UTF-8 bytes; empty list fails. Each file receives unique suiteRoot under `/suite-state/suites`; HOME/XDG/db/config/plugin/settings/log/temp paths stay inside it.

Fixture child admission is one-time inherited-pipe capability with exact realpath/argv/owner/expiry and subset `fs|loopback`; shell false. Default child process, Worker, cluster, provider executable, DNS, non-loopback network, and unregistered listener access is denied. Loopback registry is a separate runner-owned process on inherited IPC, only 127.0.0.1/::1 port 0, owner-scoped close.

Teardown: stop admissions; abort clients; close listeners; await fixture children; inspect active handles/requests; delete suiteRoot; compare immutable inventory; aggregate exit. SIGINT/SIGTERM forwards once, waits 5s, kills survivors, then tears down. Failure precedence: bootstrap/binding 90; OS containment 80; JS containment 70; leak/teardown 60; test assertion 50; signal 40.

## 4. Inline filesystem migration groups

HERM-FS-T1 owns:
`test/model-routing/config.test.ts;test/e2e/model-routing-flag.test.ts;test/e2e/mcp-builder-integration.test.ts;test/mcp-builder/loader.test.ts` and only constructor/root injection production symbols required by them.

HERM-FS-T2 owns:
`test/setup/claude-code-setup.test.ts;test/setup/gateway-setup.test.ts;test/vault.test.ts;test/vault/multi-key.test.ts;test/vault-audit.test.ts;test/vault-concurrency.test.ts;test/bridge/config.test.ts;test/bootstrap/bridge.test.ts` and their explicit config/settings/vault root injection symbols.

HERM-FS-T3 owns:
`test/code-search/hybrid-integration.test.ts;test/code-search/searcher.test.ts;test/e2e/code-search-modes.test.ts;test/cost-integration.test.ts;test/cost-tracker.test.ts;test/comparison/persistence.test.ts;test/http-analytics.test.ts;test/http-logs.test.ts` and their explicit cwd/db/index/log root injection symbols.

All other tests remain guarded; a newly detected external write is a red inventory requiring a new concrete owner.

## 5. Exact Buildx identity and run commands

Docker documents `--iidfile` as the image-ID output, `--load` as loading the single-platform result into the local image store, and `containerimage.config.digest` as the config digest in `--metadata-file`. This is source-read documentation evidence; the command remains proposed until executed. CI-ROOT pins and preflights `jq-1.7.1`.

```sh
set -eu
TMP="$RUNNER_TEMP/wp00-inventory"
mkdir -p "$TMP"
cleanup() {
  docker rm -f mcp-llm-bridge-wp00-test >/dev/null 2>&1 || true
  docker image rm -f mcp-llm-bridge:test-wp00 >/dev/null 2>&1 || true
  if test -n "${IID:-}"; then docker image rm -f "$IID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM
test "$(jq --version)" = "jq-1.7.1"
node test/contracts/outward-scanner.mjs inventory   --root "$GITHUB_WORKSPACE"   --paths-file "$TMP/paths.bin"   --manifest-file "$TMP/manifest.json"   --provider-subject-hash-file "$TMP/provider-subject-hash.txt"
docker buildx build --load   --file Dockerfile.test   --iidfile "$TMP/image.iid"   --metadata-file "$TMP/build-metadata.json"   --tag mcp-llm-bridge:test-wp00   .
META_DIGEST="$(jq -er '.[\"containerimage.config.digest\"]' "$TMP/build-metadata.json")"
IID="$(cat "$TMP/image.iid")"
INSPECT_ID="$(docker image inspect --format '{{.Id}}' mcp-llm-bridge:test-wp00)"
DIGEST_RE='^sha256:[0-9a-f]{64}$'
printf '%s\n' "$META_DIGEST" "$IID" "$INSPECT_ID" | grep -Ex "$DIGEST_RE" >/dev/null
test "$META_DIGEST" = "$IID"
test "$IID" = "$INSPECT_ID"
docker run --rm   --name mcp-llm-bridge-wp00-test   --network none   --read-only   --user 65532:65532   --workdir /app   --tmpfs /tmp:rw,nosuid,nodev,noexec,size=536870912,uid=65532,gid=65532,mode=1700   --tmpfs /suite-state:rw,nosuid,nodev,noexec,size=536870912,uid=65532,gid=65532,mode=1700   --env HOME=/suite-state/home   --env XDG_CONFIG_HOME=/suite-state/config   --env XDG_CACHE_HOME=/suite-state/cache   --env XDG_DATA_HOME=/suite-state/data   --env WP00_PATHS_FILE=/inventory/paths.bin   --env WP00_MANIFEST_FILE=/inventory/manifest.json   --mount type=bind,src="$TMP",dst=/inventory,readonly   "$IID"
git diff --exit-code
test -z "$(git status --porcelain)"
```

HERM-IMAGE creates candidate-root `Dockerfile.test` before this command; pinned HEAD does not contain that proposed file, while pinned HEAD `Dockerfile` is the production image and is never selected by the hermetic build. The explicit `--file Dockerfile.test` therefore selects the reviewed candidate test image. The container is invoked by verified content-addressed IID, never tag or RepoDigest. `Dockerfile.test` fixes `USER 65532:65532`, `WORKDIR /app`, and `ENTRYPOINT ["node","test/hermetic/bootstrap.mjs"]`; the baked `/app` candidate is read-only and bound to paths.bin/manifest. Negative fixtures delete `containerimage.config.digest`, substitute malformed/uppercase/short digests, force IID/inspect mismatch, and retag `mcp-llm-bridge:test-wp00` after verification; each must fail identity validation or prove the saved IID remains the only run operand. The trap removes container, tag, and verified local image on success, failure, or signal.


## 6. Dashboard job

```sh
set -eu
pnpm --dir dashboard install --frozen-lockfile
pnpm --dir dashboard test
pnpm --dir dashboard exec tsc -b
pnpm --dir dashboard exec vite build   --outDir "$RUNNER_TEMP/dashboard-dist"   --emptyOutDir
node scripts/verify-dashboard-assets.mjs   --built-root "$RUNNER_TEMP/dashboard-dist"   --tracked-root docs   --static-source dashboard/public/favicon.svg   --static-built "$RUNNER_TEMP/dashboard-dist/favicon.svg"   --static-tracked docs/favicon.svg   --static-source dashboard/public/icons.svg   --static-built "$RUNNER_TEMP/dashboard-dist/icons.svg"   --static-tracked docs/icons.svg   --manifest test/contracts/dashboard-assets.json
git diff --exit-code
test -z "$(git status --porcelain)"
```

DASH-CI scenarios belong to CI-DASH. Stale, extraneous, missing, mode or byte mismatch fails. Root Node runner and dashboard Vitest/build never share runner, install, lockfile or proof claims.

## 7. SVG verifier direction

The CLI parser consumes options as ordered groups of exactly three adjacent flags: `--static-source`, then `--static-built`, then `--static-tracked`. It rejects incomplete groups, reordered flags, duplicate source/built/tracked paths, cross-pair reuse, paths outside the declared roots, or a group count other than two. For each group it verifies source bytes/mode 100644 equal built bytes/mode 100644, then built bytes/mode equal tracked bytes/mode 100644. Regeneration updates the tracked destination only from the validated built output; it never copies from tracked output or passes `docs/*.svg` as source. The built/tracked allowlists remain exactly index.html, assets/**, favicon.svg, and icons.svg; the three enumerated Markdown docs remain excluded.

## 8. Current-main execution refresh

Immutable inventory: 521 records; `paths.bin` SHA-256 `1684691f152267c73277d56967cf8c9e6f524d26abdd8340b8b0100e684314a6`; sorted `git ls-tree -r -z --full-tree` SHA-256 `2eb6d1b2e2108fd5df84b1df2da4fa0df721041db1f6973165be62031ff4ca8a`. CI-ROOT must preserve both 15-second timeout environment variables inside the guarded container; they constrain tests only and never change the 30-minute serving default. Root discovery includes the six changed tests. Their functional assertions belong to DIST-CLI or ERR-HTTP-API-A; only path/root/cleanup edits belong to HERM-FS-T3. StubAdapter-based full-pipeline, three-part-prompt, and log tests remain provider-free; `test/http.test.ts` may register production adapters for shape coverage but the guard forbids invocation.

## 9. Planned developer-container ownership

SCAN-ROOT-INVENTORY discovers the planned .devcontainer/devcontainer.json and .devcontainer/Dockerfile as roots; SCAN-ROOT-PACKAGE and SCAN-ROOT-DOCKER parse their execution-bearing fields through the shared API; aggregate SCAN-ROOT rejects missing dispatch, unsupported execution-affecting fields, or any unparsed root. Those paths are not present facts in this revision. HERM-IMAGE is their sole implementation owner and must provide a credential-free, non-root Node 22.23.2 / pnpm 9.15.9 developer container with ABI-isolated dependency volumes and reset guidance. Dockerfile.test remains HERM-IMAGE's distinct hermetic evidence image and MUST NOT be replaced by the developer or production Dockerfile.

CI-ROOT owns .node-version, root package.json Node/pnpm declarations, and exact CI runtime pins; CI-DASH owns matching dashboard/package.json declarations while preserving the independent dashboard lockfile/project. CLAIMS-FINAL verifies README developer setup, frozen installs, ABI-volume reset steps, and the explicit absence of default credentials. DIST-CLI retains production Docker/Compose remediation only. CI-ROOT owns the exact whole-root test command; HERM-RUNNER owns its liveness, bounded concurrency, teardown/signals, and diagnostic timeouts.
