# Dev Container MCP/HTTP proof

This is an opt-in, persistent proof harness for the current application entrypoint. The default test suite does not start Docker or a Dev Container.

## Invocation

Run the Docker-free unit tests with:

```sh
node --import tsx --test test/wp00/devcontainer-mcp-http-proof.test.ts
```

The live proof is deliberately explicit:

```sh
pnpm run test:wp00:devcontainer
```

That script is the only path that passes `--run`. It performs at most one `devcontainer up` and one `devcontainer exec`, using argv arrays, a unique identity label, and a unique `/tmp` user-data folder. The runner supplies no explicit build or pull directive, although the Dev Container CLI may acquire the configured image according to its normal behavior. It does not override networking, use `--remove-existing-container`, or stop/remove containers and volumes.

## Safety and cleanup ownership

The container-side child receives an explicit, non-inherited environment. Its synthetic key and SQLite database live under `/tmp`; auth, plugins, discovery, routing, catalog, local LLMs, tracing, and provider credentials are disabled or empty. The runner leaves lifecycle ownership with the Dev Container tooling/operator. It performs no cleanup, because removing a container or volume could affect resources it does not own.

## Evidence boundaries

The proof starts `node --import tsx src/index.ts --http`, calls MCP `tools/list` exactly once, then performs one loopback `GET /health`. The receipt is bounded and versioned. A healthy HTTP response proves startup and route availability only; it does **not** prove provider availability, generation readiness, or successful tool execution.

## Known limitations

The live command requires an existing compatible Dev Container configuration and dependencies. It is intentionally not run by unit tests or typecheck. Health itself may inspect provider status, but the harness does not invoke providers or generate content. Existing container lifecycle and volume cleanup remain the operator's responsibility.
