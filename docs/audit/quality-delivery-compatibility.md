# Quality, delivery, and compatibility findings

The repository has a large backend test corpus, but publication paths do not require it to pass. Container and npm artifacts also do not yet provide reproducible, minimal, verifiable releases.

## DEL-01 — Publication is not gated by source CI

**Priority:** P0 / Critical for release integrity

### Evidence

- The Docker workflow checks out, logs in, builds, and pushes; it has no install, typecheck, unit-test, or source-build step before publication: `.github/workflows/docker.yml:29-68`.
- Pages builds the dashboard but does not run dashboard tests: `.github/workflows/deploy-pages.yml:19-55`.
- The project already defines `test`, `build`, and `typecheck`: `package.json:11-18`.

### Impact

`main` can publish `latest` even when TypeScript, tests, or source bundling is broken. The container build is therefore acting as the primary gate even though it runs the development entry point and tolerates missing CLI installs.

### Recommendation

Create a required CI workflow with frozen install, formatting/lint if adopted, typecheck, backend tests, dashboard tests, production build, `npm pack` smoke test, and container smoke/health test. Make publication depend on successful CI or promote an already-tested immutable artifact by digest.

## DEL-02 — Docker build is non-reproducible and fail-open

**Priority:** P1 / High

### Evidence

- OpenCode is downloaded with a pinned version but no checksum/signature verification: `Dockerfile:24-31`.
- npm CLI packages are unversioned: `Dockerfile:33-40`.
- `npm install -g ... || true` allows partial failure and continues after warnings: `Dockerfile:35-47`.
- `COPY . .` broadens build context and risks copying unintended artifacts permitted by ignore rules: `Dockerfile:49-53`.

### Recommendation

- Pin every CLI and base image by version/digest according to update policy.
- Verify downloaded checksums/signatures.
- Fail the build if required CLIs are unavailable; make optional CLIs explicit build features.
- Copy only the built application and required runtime assets.
- Generate an SBOM and provenance attestation; scan the final image.

## DEL-03 — Runtime image includes development execution

**Priority:** P1 / High

`pnpm install --prod=false` installs dev dependencies, the repository is copied wholesale, and `CMD ["pnpm", "run", "serve"]` runs `tsx src/index.ts serve`: `Dockerfile:49-61`; `package.json:12-16`.

This increases size and attack surface and means the shipped code path differs from the declared npm `main` (`dist/index.js`). Use a separate application build stage, install production dependencies only (or create a self-contained bundle), copy `dist` and explicit runtime assets, and run as a non-root user with read-only filesystem and writable mounts only where required.

## DEL-04 — Coverage and quality thresholds are absent

**Priority:** P2 / Medium

The reviewed tree contains 255 TypeScript files under `src` and 156 `*.test.ts` backend suites, demonstrating substantial investment. Four dashboard test files were found under `dashboard/src/**/__tests__`. However, `package.json:15-17` exposes no coverage command or threshold and the publication workflows do not execute tests.

Add statement/branch/function/line thresholds, publish coverage artifacts, track critical-path coverage separately, require dashboard tests, and add targeted negative tests for tenant isolation, admin configuration, cancellation, chunked bodies, plugin termination, packaging, and shutdown.

## DEL-05 — npm release contract is incomplete

**Priority:** P2 / Medium

`package.json:1-18` defines name/version/main/files/bin/scripts but not a visible `exports`, `types`, `engines`, `packageManager`, repository, bugs, homepage, `prepack`/`prepublishOnly`, or release smoke scripts. The `files` list includes only `dist` and `README.md`, which is relevant to runtime configuration assets.

### Recommendation

- Add `exports`, `types`, supported Node `engines`, and pinned package manager.
- Add repository/support metadata.
- Build and validate in `prepack`; avoid surprising publish-time mutation.
- Install the tarball into a clean temporary project and run CLI/help/startup smoke tests.
- Publish with provenance, immutable tags, checksums, and an SBOM.

## DOC-01 — Release and capability documentation drift

**Priority:** P2 / Medium

### Evidence

- Package version is `0.6.0`: `package.json:3`.
- README says there are 11 adapters: `README.md:27`.
- `VALID_PROVIDERS` and adapter implementations show a larger current provider set: `src/core/constants.ts:36-56`; `src/adapters/`.
- README examples report `0.3.1` and explicitly state package/runtime versions are not kept synchronized: `README.md:532-540`.
- Changelog still records the 11-adapter milestone: `CHANGELOG.md:38`.

### Impact

Operators cannot confidently identify the running version or supported providers, and release notes do not represent the deployed capability set.

### Recommendation

Use one build-time version source, generate health/version output from release metadata, automate changelog/release notes, and test README provider tables against the provider registry. Avoid mutable or descriptive tags as the only release identity; publish SemVer tags plus commit/image digest.

## DOC-02 — Dashboard documentation and test depth lag the product

**Priority:** P3 / Low

`dashboard/README.md:1-12` identifies itself as the React + TypeScript + Vite template and discusses template plugins/compiler behavior; `dashboard/README.md:16-72` continues with generic ESLint guidance rather than product architecture, local setup, environment variables, auth flows, deployment, or troubleshooting. The reproducible search `find dashboard/src -path '*__tests__*' -type f -print` returns exactly four files in the reviewed tree: `dashboard/src/api/__tests__/client.test.ts`, `dashboard/src/components/__tests__/KpiCard.test.tsx`, `dashboard/src/components/__tests__/StatusBadge.test.tsx`, and `dashboard/src/pages/__tests__/Login.test.tsx`. This file-name inventory establishes limited breadth, not the adequacy of every assertion. Replace the template with product documentation and extend tests to administrative mutations, authorization failures, loading/error states, routing, and contract changes.

## API-01 — OpenAI compatibility is a subset

**Priority:** P2 / Medium

The chat schema supports `system`, `user`, and `assistant` roles, string-only content, and a limited option set: `src/core/schemas.ts:28-46`. It does not declare the complete contemporary OpenAI surface such as tool-call messages, multimodal content parts, response formats, seeds, log probabilities, or multiple choices.

The issue is not that every feature must be implemented; it is that “OpenAI-compatible” can cause clients to assume behavior that is not promised. Publish an exact compatibility matrix with supported fields, ignored/rejected fields, streaming event shape, errors, usage accounting, and model naming. Namespace gateway-only options (for example, `x_gateway`) rather than colliding with upstream fields.

## API-02 — No versioned machine-readable public contract

**Priority:** P2 / Medium

No OpenAPI artifact or dedicated official-SDK conformance suite was identified by this repository-wide filename search, run from the repository root and excluding `.git` and `node_modules`:

```bash
find . -path './node_modules' -prune -o -path './.git' -prune -o \
  -type f \( -iname '*openapi*' -o -iname '*swagger*' \
  -o -iname '*sdk*test*' -o -iname '*contract*test*' \) -print
```

The only result in the reviewed tree was `./test/core/router-execution-contract.test.ts`; its scope is the internal router execution contract, not a published OpenAPI document or official-SDK HTTP conformance suite. This is an explicitly scoped absence search by filename, not proof that no ad hoc compatibility assertion exists inside a differently named test. Without a versioned machine-readable artifact and a discoverable conformance suite, HTTP behavior, dashboard client expectations, and external integrations can drift.

Generate OpenAPI from the same Zod operation contracts used at runtime, version it, and run contract tests through supported versions of the official OpenAI and Anthropic SDKs. Test normal, streaming, validation-error, auth-error, rate-limit, cancellation, and provider-failure cases. Define a deprecation window and backward-compatibility policy.

## Recommended CI pipeline

1. **Source:** frozen install, typecheck, lint/format policy, unit/integration tests, coverage thresholds.
2. **Dashboard:** frozen install, tests, typecheck, production build.
3. **Package:** build `dist`, `npm pack`, clean-install smoke tests, inspect tarball contents.
4. **Container:** build from immutable inputs, vulnerability scan, non-root/read-only checks, health and shutdown tests.
5. **Contracts:** OpenAPI validation and official SDK conformance.
6. **Release:** SemVer/changelog validation, SBOM, provenance, signed immutable artifact promotion.

## Delivery acceptance checklist

- [ ] `latest` cannot publish unless source, dashboard, package, and container gates pass.
- [ ] Every required CLI is pinned, verified, and present, or the build fails.
- [ ] Final image runs `dist` as non-root without dev dependencies.
- [ ] `npm pack` contains all required runtime assets and passes clean-install smoke tests.
- [ ] Runtime version, package version, image label, release tag, and health response agree.
- [ ] README provider inventory is generated or contract-tested against source.
- [ ] Compatibility claims link to a versioned matrix and OpenAPI document.

