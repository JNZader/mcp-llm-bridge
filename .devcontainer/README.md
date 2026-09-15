# Public native-binding Dev Container

Use the public image by its exact immutable digest. It was anonymously validated for Linux
amd64 with Node `22.23.2` (ABI `127`) and the native-binding receipt. The runtime has no
network, runs as `node`, and uses a named volume for workspace `node_modules`; host
dependencies are not mounted or consumed.

```text
ghcr.io/jnzader/mcp-llm-bridge-dev@sha256:855cac4d86039b612e453d2b4a64f789aaff17a5c04b39444afc4ae121444bfa
```

The checked-in `devcontainer.json` consumes this digest directly. It retains the disabled
provider/model/plugin flags and runs `postCreateCommand` only to seed and verify the named
volume; it does not install or rebuild packages.

## Maintainers: rebuild and publish

This recipe is maintainer-only. The caller must supply an approved, digest-pinned Node base
image; do not substitute a tag or invent a digest. The placeholder below is intentionally
not usable:

```bash
export NODE_IMAGE='node:22.23.2-bookworm@sha256:<64 lowercase hex characters>'
export IMAGE_REF='ghcr.io/jnzader/mcp-llm-bridge-dev:<approved-publication-tag>'
docker build --platform linux/amd64 --file .devcontainer/Dockerfile \
  --build-arg NODE_IMAGE="$NODE_IMAGE" --tag "$IMAGE_REF" .
```

Use `.devcontainer/Dockerfile` with that caller-supplied digest. It rejects missing,
unpinned, wrong-version, and wrong-ABI inputs; builds must retain the generated native
receipt and its verification. Publish the resulting image explicitly through the separately
approved registry workflow (for example, `docker push "$IMAGE_REF"`), record its immutable
digest and receipt, then update `devcontainer.json` to the new digest. No registry query is
performed by this change.

## Maintainer checklist

1. Resolve and approve the base-image digest outside this change.
2. Build `.devcontainer/Dockerfile` with `NODE_IMAGE` set as above; the build installs exact
   pnpm, compiles the native dependency while networking is still available, and runs the
   verifier.
3. Inspect and retain the generated `native-binding-receipt.json`.
4. Publish the resulting image explicitly only through the separately approved registry
   workflow, recording its immutable digest and receipt.
5. Update `devcontainer.json` from the old digest to the newly recorded immutable digest.
6. Open the Dev Container with `--network=none`; `postCreateCommand` only seeds the named
   volume and performs a read-only verification. It never installs or rebuilds packages.

## Receipt

The machine-readable receipt contains schema, Node version, ABI, platform, architecture,
libc family, pnpm lock SHA-256, resolved package/version, native binding path, and native
binding SHA-256. The verifier also imports the binding and executes in-memory `SELECT 1`.
An existing receipt must match every calculated field.

## Invalidation matrix

Rebuild and re-verify when any of these changes:

| Input | Why it invalidates the receipt |
| --- | --- |
| Base image digest | Changes system libraries or supplied Node runtime |
| Node version or ABI | Native module ABI compatibility changes |
| Architecture or libc | Native binary compatibility changes |
| pnpm lockfile | Resolved dependency tree changes |
| `better-sqlite3` version | Native source and binding change |

## Limitations and status

The public digest was validated anonymously for Linux amd64, Node `22.23.2`/ABI `127`, and
native receipt validation; that validation does not prove every application workflow. The
maintainer recipe assumes the build context contains the repository dependency metadata and
`.devcontainer` files. The seed script rejects nonempty or differently seeded volumes and
symlink escapes; it does not repair a contaminated volume. Runtime environment flags disable
dynamic MCP loading, provider/model discovery, and routing, but application behavior still
requires the normal runtime entrypoint and separately supplied nonsecret configuration.

**No container was run by this configuration/documentation change.** No Docker build, pull,
push, or runtime execution was performed here; operational behavior beyond the recorded
public-image validation, including volume seeding and network isolation, remains subject to
the applicable authorized workflow.
