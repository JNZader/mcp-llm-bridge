<div align="center">

# MCP LLM Bridge

**Encrypted LLM gateway and MCP server for routing API keys, CLI subscriptions, and model selection through one OpenAI-compatible endpoint.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://docs.docker.com/)

</div>

## Demo Links

- Live gateway: [https://gateway.javierzader.com](https://gateway.javierzader.com)
- GHAGGA integration target: [https://github.com/JNZader/ghagga](https://github.com/JNZader/ghagga)
- OpenCode: [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)

Visuals coming soon.

## Quick Portfolio Snapshot

- One service for LLM routing, encrypted credential storage, MCP tooling, and OpenAI-compatible HTTP access.
- 11 provider adapters today: 5 direct API providers plus 6 CLI-backed providers.
- Supports API keys and auth-file workflows, including `auth.json` and `.credentials.json`.
- Includes task-aware bridge routing, model routing, project-scoped credentials with global fallback, semantic code search, context compression, and CRDT shared state.
- Ships as a local dev tool, self-hosted HTTP gateway, MCP stdio server, and Docker deployment.

## Why It Matters

- Centralizes secrets instead of scattering provider tokens across every project and tool.
- Lets you reuse CLI subscriptions such as OpenCode, Claude, Gemini, Codex, Qwen, and Copilot behind one interface.
- Gives OpenAI-compatible tools a single stable endpoint while preserving provider/model resolution metadata.
- Supports multi-project setups where project-specific credentials override `_global` defaults cleanly.
- Exposes MCP tools beyond plain generation: vault operations, code search, shared state, usage inspection, and provider-group management.

## Quick Start

```bash
pnpm install
pnpm run serve
```

Open `http://localhost:3456`.

Store a credential and generate text:

```bash
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'
```

If you set `LLM_GATEWAY_AUTH_TOKEN`, add `Authorization: Bearer <token>` to every protected route.

## Jump to Technical Docs

- Full API reference: [Technical README](#technical-readme)
- Auth and credential model: [Authentication](#authentication), [Credential Management](#credential-management)
- MCP integration: [MCP Server](#mcp-server)
- Docker and self-hosting: [Docker Deployment](#docker-deployment)

---

## Technical README

## Table of Contents

1. [Quick Start](#quick-start-1)
2. [Dashboard](#dashboard)
3. [API Reference](#api-reference)
4. [Providers](#providers)
5. [Authentication](#authentication)
6. [Credential Management](#credential-management)
7. [Cross-Model Bridge](#cross-model-bridge)
8. [Context Compression](#context-compression)
9. [Semantic Code Search](#semantic-code-search)
10. [CRDT Multi-Agent State](#crdt-multi-agent-state)
11. [Integrations](#integrations)
12. [Docker Deployment](#docker-deployment)
13. [MCP Server](#mcp-server)
14. [Configuration](#configuration)
15. [Security Profiles](#security-profiles)
16. [Approval Flows](#approval-flows)
17. [Three-Part Prompt](#three-part-prompt)
18. [RTK Output Compression](#rtk-output-compression)
19. [Local LLM Offloading](#local-llm-offloading)
20. [Model Routing](#model-routing)
21. [HF Auto-Discovery](#hf-auto-discovery)
22. [Architecture](#architecture)
23. [Security](#security)
24. [Development](#development)
25. [License](#license)

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the HTTP server + dashboard
pnpm run serve

# MCP stdio mode only
pnpm run start
```

Basic HTTP flow:

```bash
# Store a global Anthropic key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

# Generate text with automatic provider selection
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'
```

If auth is enabled:

```bash
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'
```

## Dashboard

The gateway includes a web dashboard for managing credentials, auth files, providers, models, and test generation.

- Hosted demo: [https://gateway.javierzader.com](https://gateway.javierzader.com)
- Local dashboard: `http://localhost:3456`

### First-Time Setup

1. Start the gateway with `pnpm run serve`.
2. Open the dashboard.
3. Enter the base URL for your gateway.
4. Enter the bearer token if `LLM_GATEWAY_AUTH_TOKEN` is configured.
5. Test the connection and save.

### Dashboard Capabilities

- Add, list, filter, and delete encrypted API keys.
- Upload auth files for CLI-backed providers.
- Inspect provider availability and available models.
- Send test prompts and inspect returned provider/model metadata.
- Work with project-scoped credentials without exposing raw secrets.

Recommended auth-file mappings in the UI and API:

- `opencode` -> `auth.json`
- `claude` -> `.credentials.json`
- `codex` -> `auth.json`
- `gemini` -> `settings.json` and `oauth_creds.json`
- `qwen` -> `settings.json` and `oauth_creds.json`
- `copilot` -> use token credentials instead of auth files

## API Reference

All protected endpoints require:

```text
Authorization: Bearer <your-token>
```

When `LLM_GATEWAY_AUTH_TOKEN` is not set, auth is disabled for local development. `GET /health` always stays public.

### Core HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Public health check for uptime monitors and platforms like Coolify |
| `/metrics` | GET | Prometheus metrics export |
| `/v1/generate` | POST | Native generation endpoint |
| `/v1/chat/completions` | POST | OpenAI-compatible chat completions |
| `/v1/models` | GET | OpenAI-compatible model list |
| `/v1/providers` | GET | Provider availability and metadata |
| `/v1/latency` | GET | Current latency measurements when latency routing is enabled |
| `/v1/cost/estimate` | GET | Cost estimate for a model and token counts |
| `/v1/cost/models` | GET | Model pricing table |
| `/v1/usage` | GET | Raw usage records |
| `/v1/usage/summary` | GET | Aggregated usage summary |
| `/v1/credentials` | POST / GET | Store and list encrypted API keys |
| `/v1/credentials/:id` | DELETE | Delete a stored credential |
| `/v1/files` | POST / GET | Store and list encrypted auth files |
| `/v1/files/:id` | DELETE | Delete a stored auth file |
| `/v1/groups` | GET / POST | List or create provider groups |
| `/v1/groups/:id` | PUT / DELETE | Update or delete a provider group |

### `POST /v1/generate`

Native generation endpoint with provider/model selection and project-scoped credential resolution.

```bash
# Auto-select provider
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'

# Explicit provider + model + project
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'X-Project: my-app' \
  -d '{
    "prompt":"Write a haiku about Rust",
    "provider":"groq",
    "model":"llama-3.3-70b-versatile",
    "maxTokens":256,
    "system":"You are a poet.",
    "project":"my-app"
  }'
```

Request body:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | User prompt |
| `system` | string | No | System prompt |
| `provider` | string | No | Preferred provider ID |
| `model` | string | No | Specific model ID |
| `maxTokens` | number | No | Max output tokens |
| `project` | string | No | Credential scope |
| `strict` | boolean | No | Strict routing behavior when supported |

Response:

```json
{
  "text": "Quicksort is a divide-and-conquer...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "tokensUsed": 150,
  "requestedProvider": null,
  "requestedModel": null,
  "resolvedProvider": "anthropic",
  "resolvedModel": "claude-sonnet-4-20250514",
  "fallbackUsed": false
}
```

### `POST /v1/chat/completions`

OpenAI-compatible chat endpoint. This is the drop-in path for tools that already speak OpenAI format.

- Non-streaming and streaming requests are supported.
- System messages are collapsed into the system prompt.
- Conversation context is reconstructed from earlier messages.
- Response stays OpenAI-compatible and adds `x_gateway` metadata.

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "model":"claude-sonnet-4-20250514",
    "messages":[
      {"role":"system","content":"You are a helpful assistant."},
      {"role":"user","content":"What is the capital of France?"}
    ],
    "max_tokens":1024
  }'
```

Response:

```json
{
  "id": "chatcmpl-<uuid>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "claude-sonnet-4-20250514",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "The capital of France is Paris." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 150 },
  "x_gateway": {
    "requestedProvider": null,
    "requestedModel": "claude-sonnet-4-20250514",
    "resolvedProvider": "anthropic",
    "resolvedModel": "claude-sonnet-4-20250514",
    "fallbackUsed": false,
    "tokensUsed": 150
  }
}
```

### `GET /v1/models`

Lists available models in OpenAI-compatible format.

```bash
curl http://localhost:3456/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-sonnet-4-20250514",
      "object": "model",
      "created": 0,
      "owned_by": "llm-gateway",
      "name": "Claude Sonnet 4",
      "provider": "anthropic",
      "max_tokens": 8192
    }
  ]
}
```

### `GET /v1/providers`

Lists registered providers and their availability.

```bash
curl http://localhost:3456/v1/providers \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "providers": [
    { "id": "anthropic", "name": "Anthropic", "type": "api", "available": true },
    { "id": "openai", "name": "OpenAI", "type": "api", "available": false },
    { "id": "opencode-cli", "name": "OpenCode CLI", "type": "cli", "available": true }
  ]
}
```

### Credentials API

Store API keys encrypted at rest. Upsert key is `(provider, keyName, project)`.

```bash
# Global credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"anthropic",
    "keyName":"default",
    "apiKey":"sk-ant-api03-..."
  }'

# Project-scoped credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"openai",
    "keyName":"default",
    "apiKey":"sk-proj-...",
    "project":"my-app"
  }'
```

```json
{ "id": 1, "provider": "anthropic", "keyName": "default", "project": "_global" }
```

List credentials:

```bash
curl http://localhost:3456/v1/credentials \
  -H 'Authorization: Bearer YOUR_TOKEN'

curl 'http://localhost:3456/v1/credentials?project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "credentials": [
    {
      "id": 1,
      "provider": "anthropic",
      "keyName": "default",
      "project": "_global",
      "maskedValue": "sk-ant-...***",
      "createdAt": "2025-01-15 10:30:00",
      "updatedAt": "2025-01-15 10:30:00"
    }
  ]
}
```

Delete a credential:

```bash
curl -X DELETE http://localhost:3456/v1/credentials/1 \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

### Auth Files API

Store auth files for CLI-backed providers encrypted at rest. Upsert key is `(provider, fileName, project)`.

This is the path that preserves the older `auth.json` and `.credentials.json` workflows.

```bash
# OpenCode auth.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"opencode",
    "fileName":"auth.json",
    "content":"{\"token\":\"oc-...\"}",
    "project":"_global"
  }'

# Claude CLI .credentials.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"claude",
    "fileName":".credentials.json",
    "content":"{\"claudeAiOauth\":{...}}",
    "project":"my-app"
  }'
```

```json
{ "id": 1, "provider": "opencode", "fileName": "auth.json", "project": "_global" }
```

List auth files:

```bash
curl http://localhost:3456/v1/files \
  -H 'Authorization: Bearer YOUR_TOKEN'

curl 'http://localhost:3456/v1/files?project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "files": [
    {
      "id": 1,
      "provider": "opencode",
      "fileName": "auth.json",
      "project": "_global",
      "createdAt": "2025-01-15"
    }
  ]
}
```

Delete an auth file:

```bash
curl -X DELETE http://localhost:3456/v1/files/1 \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

### Usage, Cost, Metrics, and Health

Usage records:

```bash
curl 'http://localhost:3456/v1/usage?project=my-app&limit=50' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Usage summary:

```bash
curl 'http://localhost:3456/v1/usage/summary?groupBy=provider&project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Cost estimate:

```bash
curl 'http://localhost:3456/v1/cost/estimate?model=claude-sonnet-4-20250514&inputTokens=1000&outputTokens=500' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Prometheus metrics:

```bash
curl http://localhost:3456/metrics \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Health check:

```bash
curl http://localhost:3456/health
```

```json
{ "status": "ok", "version": "0.3.1" }
```

### Provider Groups

Provider groups let you define logical pools for balancing and failover.

```bash
curl -X POST http://localhost:3456/v1/groups \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "name":"fast-models",
    "modelPattern":"gpt-*,claude-*",
    "members":[
      {"provider":"groq","weight":2,"priority":1},
      {"provider":"anthropic","weight":1,"priority":2}
    ],
    "strategy":"weighted",
    "stickyTTL":300
  }'
```

## Providers

### API Providers

| Provider | ID | Auth | Example Models |
|----------|----|------|----------------|
| Anthropic | `anthropic` | API key | `claude-sonnet-4-20250514`, `claude-haiku-4-20250414` |
| OpenAI | `openai` | API key | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| Google | `google` | API key | `gemini-2.5-flash`, `gemini-2.5-pro` |
| Groq | `groq` | API key | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |
| OpenRouter | `openrouter` | API key | `deepseek/deepseek-chat`, `anthropic/claude-sonnet-4` |

### CLI Providers

| Provider | ID | Auth Material | Notes |
|----------|----|---------------|-------|
| OpenCode CLI | `opencode-cli` | `auth.json` from vault | Large model catalog via subscription routing |
| Claude CLI | `claude-cli` | `.credentials.json` from vault | Uses Claude Max credentials |
| Gemini CLI | `gemini-cli` | CLI auth files | Local CLI-backed execution |
| Codex CLI | `codex-cli` | `auth.json` | OpenAI CLI-backed execution |
| Qwen CLI | `qwen-cli` | CLI auth files | Qwen local/subscription access |
| Copilot CLI | `copilot-cli` | token credentials | GitHub Copilot-backed routing |

### OpenCode Model Coverage

OpenCode is the biggest catalog here and is one reason this bridge is useful.

- Free tier models under `opencode/*`
- OpenCode Go subscription models under `opencode-go/*`
- Anthropic models under `anthropic/*`
- GitHub Copilot-routed models under `github-copilot/*`
- OpenAI-routed models under `openai/*`

Representative examples from the current adapter list:

- `opencode/gpt-5-nano`
- `anthropic/claude-sonnet-4.5`
- `github-copilot/gpt-5.4`
- `openai/gpt-5.4`

### Provider Priority and Fallback

Default behavior without an explicit provider/model:

1. API providers are tried first.
2. CLI providers follow as fallback.
3. If a model is explicitly requested, the owning provider is preferred.
4. If bridge routing is enabled, the bridge can override the initial provider choice and then walk the configured fallback chain.

## Authentication

### Bearer Token

Set `LLM_GATEWAY_AUTH_TOKEN` to protect HTTP routes.

```bash
# Generate a secure token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

export LLM_GATEWAY_AUTH_TOKEN="your-64-char-hex-token"
```

The token must be at least 32 characters.

### Auth Rules

| Path | Auth Required |
|------|:-------------:|
| `GET /health` | No |
| `OPTIONS *` | No |
| `/auth/github/*` | No |
| `/v1/admin/auth-config` | No |
| All other HTTP routes, including dashboard and `/metrics`, when token is set | Yes |

Important behavior that changed from the old README:

- The dashboard is protected when bearer auth is enabled.
- MCP stdio does not use HTTP bearer auth because it runs as a local process.
- Token comparison is constant-time via `timingSafeEqual`.

### Project Scoping

Project scope can be supplied in either place:

1. JSON body field: `"project": "my-app"`
2. Header: `X-Project: my-app`

Body field wins over header.

## Credential Management

### Global vs Project Credentials

Credential resolution follows the same pattern for API keys and auth files:

1. Try the project-specific entry.
2. Fall back to `_global`.

That lets you keep a shared default while still isolating overrides per app or customer.

### API Keys

API keys are encrypted with AES-256-GCM and stored in SQLite.

```bash
# Global key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

# Project key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-project-...","project":"my-app"}'
```

### Auth Files

CLI adapters use file-based auth where necessary. These files are also encrypted and stored in the vault.

```bash
# OpenCode auth.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"opencode",
    "fileName":"auth.json",
    "content":"{\"token\":\"oc-...\"}"
  }'

# Claude CLI .credentials.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"claude",
    "fileName":".credentials.json",
    "content":"{\"claudeAiOauth\":{...}}"
  }'
```

### Claude and OpenCode Credential Sync Pattern

The vault layer also contains a Claude OAuth integration that:

1. Reads `~/.claude/.credentials.json`
2. Refreshes the token when needed
3. Syncs the token into OpenCode-style `auth.json`

That matters because this bridge can unify Claude CLI and OpenCode auth flows instead of treating them as separate credential silos.

## Cross-Model Bridge

The bridge is an optional routing layer driven by `~/.llm-gateway/bridge.yaml`.

Flow:

1. Classify the prompt into a task type.
2. Resolve a preferred provider from `routes`.
3. Try that provider first.
4. Walk `fallback_order` sequentially if it fails.

### Supported Task Types

| Task Type | Heuristic | Typical Route |
|-----------|-----------|---------------|
| `large-context` | Very large prompt/context | `gemini-cli` |
| `code-review` | Review/audit/refactor keywords | `claude-cli` |
| `fast-completion` | Short prompt | `groq` |
| `default` | No heuristic matched | configured default |

### Example `bridge.yaml`

```yaml
routes:
  large-context: gemini-cli
  code-review: claude-cli
  fast-completion: groq

default: claude-cli

fallback_order:
  - claude-cli
  - gemini-cli
  - opencode-cli
  - anthropic
  - groq
```

If the file is missing, the bridge is disabled and the normal router behavior is used.

### Bridge Response Metadata

| Field | Description |
|-------|-------------|
| `text` | Generated text |
| `provider` | Provider that answered |
| `model` | Model used |
| `taskType` | Classified task type |
| `fallbackUsed` | Whether a non-primary provider handled it |
| `latencyMs` | End-to-end latency |

## Context Compression

The `CompressorService` adds background context compression with caching.

### Strategies

| Strategy | How It Works | Good For |
|----------|-------------|----------|
| `extractive` | Keeps high-scoring sentences | general text |
| `structural` | Preserves headings and list structure | markdown/docs |
| `token-budget` | Cuts to a size budget at sentence boundaries | hard token limits |

### Usage

```typescript
import { CompressorService } from './context-compression/index.js';

const compressor = new CompressorService({
  maxCacheSize: 200,
  workerIntervalMs: 5000,
  defaultStrategy: 'extractive',
  defaultRatio: 0.5,
});

compressor.submit(longContext);
const compressed = compressor.getCompressed(longContext);
const immediate = compressor.compressNow(longContext, 'structural');
compressor.destroy();
```

### Operational Characteristics

- LRU cache for repeated content
- Background worker for non-blocking pre-computation
- Synchronous compression when you need the result immediately
- Useful for prompt pipelines where raw context would otherwise blow up token budgets

## Semantic Code Search

The code-search subsystem exposes three search modes through MCP:

- **keyword** (default): exact/prefix/fuzzy matching with inverted index
- **vector**: semantic similarity via dense embeddings
- **hybrid**: RRF fusion of keyword + BM25 + vector for best results

It combines:

- regex-based chunking
- trigram fuzzy search
- BM25 keyword scoring (via MiniSearch)
- dense vector similarity (via transformer embeddings)
- Reciprocal Rank Fusion (RRF) for hybrid ranking
- optional multi-hop import following

### Supported Languages

Default chunking support covers:

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.lua`

### MCP Search Tools

`index_codebase`:

```json
{
  "rootDir": "/path/to/project",
  "extensions": [".ts", ".js"],
  "ignorePatterns": ["node_modules", "dist"]
}
```

`code_search`:

```json
{
  "query": "authentication middleware",
  "scope": "/path/to/project",
  "limit": 10,
  "followImports": true,
  "mode": "hybrid"
}
```

Returned results include file path, symbol name, kind, content, line numbers, score, and related chunks when import following is enabled.

### Search Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `keyword` | Exact token matching, prefix search, trigram fuzzy fallback | Known symbol names, fast, no model needed |
| `vector` | Cosine similarity over 384-dim embeddings | Conceptual queries, synonyms, semantic relatedness |
| `hybrid` | RRF fusion of keyword + BM25 + vector | General use — combines precision + recall |

**Keyword mode** is the default and requires no setup. It scores exact name matches highest, then prefix matches, then keyword-in-content, then trigram fuzzy similarity.

**Vector mode** uses a local embedding model (`Xenova/all-MiniLM-L6-v2`, 22MB, 384-dimensional). On first run the model downloads automatically from HuggingFace and caches locally. Vector search finds semantically related code even when keywords don't overlap.

**Hybrid mode** runs all three strategies in parallel and fuses the rankings with Reciprocal Rank Fusion (RRF). Results include `rrfScore` (the fused score) and `methodCount` (how many strategies found the result). Items found by multiple methods rank higher, giving the best overall coverage.

### Embedding Model

- Model: `Xenova/all-MiniLM-L6-v2` (22MB, 384-dim)
- Backend: `@xenova/transformers` (ONNX runtime, runs locally)
- First run: model auto-downloads and caches to `~/.cache/huggingface/`
- Fallback: if the local model fails to load, the embedder can fall back to OpenAI API (`text-embedding-3-small`) when `OPENAI_API_KEY` is set

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDER_MODE` | `local` | `local` uses Xenova transformer; `api` forces OpenAI API |
| `OPENAI_API_KEY` | — | Fallback API embedder key (optional) |
| `VOYAGE_API_KEY` | — | Alternative API embedder key (optional) |
| `TRANSFORMERS_OFFLINE` | — | Set to `1` to use only cached model, skip download |

## CRDT Multi-Agent State

The `shared_state` MCP tool gives agents a conflict-free shared state layer.

### Supported CRDTs

| Type | Merge Semantics | Good For |
|------|-----------------|----------|
| `g-counter` | max-per-node counter merge | token/request tracking |
| `lww-register` | last-writer-wins by timestamp | status/assignment |
| `or-set` | observed-remove set | shared findings or artifacts |

### Example Operations

```json
{ "op": "write", "key": "tokens", "type": "g-counter", "nodeId": "agent-1", "amount": 150 }
{ "op": "write", "key": "status", "type": "lww-register", "nodeId": "agent-1", "value": "analyzing" }
{ "op": "write", "key": "findings", "type": "or-set", "nodeId": "agent-1", "action": "add", "element": "Issue in auth.ts:42" }
{ "op": "read", "key": "findings" }
{ "op": "snapshot" }
{ "op": "merge", "snapshot": { "entries": {} } }
```

This is useful when multiple coding or review agents need to coordinate without central locking.

## Integrations

### OpenCode

Configure OpenCode to treat the gateway as an OpenAI-compatible provider.

```json
{
  "provider": {
    "llm-gateway": {
      "name": "LLM Gateway",
      "api": "openai",
      "apiKey": "env:LLM_GATEWAY_TOKEN",
      "baseURL": "https://llm-gateway.yourdomain.com/v1",
      "models": {
        "gateway-anthropic": {
          "name": "Anthropic via Gateway",
          "id": "claude-sonnet-4-20250514",
          "contextWindow": 200000,
          "maxOutput": 8192
        },
        "gateway-groq": {
          "name": "Groq via Gateway",
          "id": "llama-3.3-70b-versatile",
          "contextWindow": 128000,
          "maxOutput": 4096
        }
      }
    }
  }
}
```

```bash
export LLM_GATEWAY_TOKEN="your-gateway-auth-token"
opencode
```

### GHAGGA

[GHAGGA](https://github.com/JNZader/ghagga) can use the bridge as a provider.

1. Select `LLM Gateway` in the GHAGGA dashboard.
2. Enter the gateway base URL.
3. Enter the gateway bearer token.
4. Pick a model.

Typical review modes routed through the gateway:

- simple
- workflow
- consensus

### Any OpenAI-Compatible Tool

General settings:

| Setting | Value |
|---------|-------|
| Base URL | `https://llm-gateway.yourdomain.com/v1` |
| API Key | your `LLM_GATEWAY_AUTH_TOKEN` |

Works with LangChain, LlamaIndex, Cursor, Continue, and any HTTP client that can call `/v1/chat/completions`.

LangChain Python example:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://llm-gateway.yourdomain.com/v1",
    api_key="your-gateway-token",
    model="claude-sonnet-4-20250514",
)

response = llm.invoke("Explain quicksort")
print(response.content)
```

LangChain TypeScript example:

```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  configuration: {
    baseURL: 'https://llm-gateway.yourdomain.com/v1',
  },
  apiKey: 'your-gateway-token',
  model: 'claude-sonnet-4-20250514',
});

const response = await llm.invoke('Explain quicksort');
```

## Docker Deployment

### Docker Compose

```yaml
services:
  llm-gateway:
    build: .
    ports:
      - "3456:3456"
    volumes:
      - llm-data:/root/.llm-gateway
    environment:
      - LLM_GATEWAY_PORT=3456
      - LLM_GATEWAY_AUTH_TOKEN=your-secure-token-here
      - LLM_GATEWAY_MASTER_KEY=your-64-char-hex-key
volumes:
  llm-data:
```

```bash
docker compose up -d
```

### Docker Build and Run

```bash
docker build -t llm-gateway .

docker run -d \
  -p 3456:3456 \
  -v llm-data:/root/.llm-gateway \
  -e LLM_GATEWAY_AUTH_TOKEN="your-token" \
  -e LLM_GATEWAY_MASTER_KEY="your-64-char-hex-key" \
  llm-gateway
```

### What the Image Includes

The Dockerfile currently installs:

- `pnpm` 9
- OpenCode CLI
- Claude Code CLI
- Gemini CLI
- Codex CLI
- Qwen CLI
- GitHub Copilot CLI

### Coolify

1. Create a new service pointing at this repository.
2. Use the Dockerfile build pack.
3. Set environment variables such as `LLM_GATEWAY_PORT`, `LLM_GATEWAY_AUTH_TOKEN`, and optionally `LLM_GATEWAY_MASTER_KEY`.
4. Mount a persistent volume at `/root/.llm-gateway`.
5. Use `/health` for health checks.

## MCP Server

The project runs as an MCP stdio server by default.

### Primary MCP Tools

| Tool | Description |
|------|-------------|
| `llm_generate` | Generate text with provider routing and fallback |
| `llm_models` | List available models |
| `vault_store`, `vault_list`, `vault_delete` | API key management |
| `vault_store_file`, `vault_list_files`, `vault_delete_file` | Auth-file management |
| `code_search`, `index_codebase` | Semantic code search |
| `shared_state` | CRDT shared state |
| `list_groups`, `create_group`, `delete_group` | Provider group management |
| `usage_summary`, `usage_query` | Cost and usage inspection |
| `configure_circuit_breaker`, `circuit_breaker_stats` | Provider failure-control tuning |

### Claude Code Config

Add to `~/.config/claude/mcp.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

For a local source checkout:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-llm-bridge/src/index.ts"]
    }
  }
}
```

### Claude Desktop Config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

MCP stdio runs locally and does not use the HTTP bearer-token middleware.

## Dynamic MCP Servers

The bridge supports loading external `.mcp-server.js` plugin files at runtime. This lets you extend the toolset without modifying the core codebase.

### What It Is

Any `.mcp-server.js` file placed in the plugin directory is loaded at startup and its tools are registered alongside the 27 static tools. Plugins export a `McpServerDefinition` object (or use the builder) with tools, resources, and prompts.

### Enable

Set `MCP_DYNAMIC_SERVERS=true`:

```bash
export MCP_DYNAMIC_SERVERS=true
export MCP_SERVERS_DIR=./mcp-servers
```

### Create a Plugin

Create a `.mcp-server.js` file in the plugin directory:

```javascript
import { McpServerBuilder } from 'mcp-llm-bridge/mcp-builder';

export default new McpServerBuilder()
  .tool('greet', 'Say hello to someone', { name: { type: 'string' } }, async ({ name }) => {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  })
  .build();
```

The builder validates naming conventions, schema completeness, and description quality. Tools are registered on the MCP server and appear in `ListTools`.

### Directory

The default plugin directory is `./mcp-servers`. Override with:

```bash
export MCP_SERVERS_DIR=./my-custom-plugins
```

### Security

Dynamic tools are registered with the `read` category by default. This means they are:

- **Allowed** under `local-dev` and `restricted` profiles
- **Blocked** under the `open` profile (which only allows `generate` tools)

The enforcer applies the same category-based filtering to dynamic tools as it does to static tools.

### Coexistence with Static Tools

Static tools (vault, search, generate, etc.) and dynamic tools appear together in the `ListTools` response. There is no namespacing — tool names must be unique across both sets. The approval flow and rate limiting apply uniformly to all tools.

## Configuration

### Core Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_GATEWAY_PORT` | `3456` | HTTP server port |
| `LLM_GATEWAY_DB_PATH` | `~/.llm-gateway/vault.db` | SQLite vault path |
| `LLM_GATEWAY_MASTER_KEY` | auto-generated | 64-char hex key, otherwise saved to `~/.llm-gateway/master.key` |
| `LLM_GATEWAY_AUTH_TOKEN` | unset | Bearer token for HTTP routes |
| `LLM_GATEWAY_AUTH_REQUIRED` | unset | Force auth on or off explicitly |
| `LLM_GATEWAY_SECURITY_PROFILE` | `local-dev` | Security profile for MCP tool exposure |

### Optional Runtime Features

| Variable | Effect |
|----------|--------|
| `FALLBACK_STRATEGY=free-models` | enables free-model fallback routing |
| `FREE_MODEL_CATALOG=true` | loads the free-model catalog at startup |
| `LATENCY_ROUTING=true` | enables latency-based routing |
| `MAX_COMPARISON_COST_USD` | caps comparison-service spending |

### Master Key Priority

1. `LLM_GATEWAY_MASTER_KEY`
2. existing `~/.llm-gateway/master.key`
3. auto-generated new key written with mode `0600`

If you lose the master key, stored credentials are unrecoverable. Back it up in production.

### Bridge Config Path

`~/.llm-gateway/bridge.yaml`

If that file does not exist, bridge routing is disabled.

## Security Profiles

Security profiles enforce trust-level-based access control on both MCP tools and HTTP endpoints. Three profiles are built-in:

| Profile | Allowed Categories | Rate Limit | Sandbox |
|---------|-------------------|------------|---------|
| `local-dev` | all (destructive, read, generate, admin) | none | false |
| `restricted` | read + generate only | 100 req / 15 min | false |
| `open` | generate only | 10 req / 15 min | false |

### Configuration

Set via environment variable:

```bash
LLM_GATEWAY_SECURITY_PROFILE=restricted
```

Default is `local-dev` (backward compatible — no restrictions).

Each profile also carries a `sandbox` flag (default `false`). When `sandbox: true`, the profile indicates that the project should run in an isolated/sandboxed mode. This flag is exposed on the profile schema and through the admin API for per-project configuration.

### HTTP Enforcement

Under `restricted` or `open`, the gateway blocks destructive HTTP endpoints (e.g., `POST /v1/credentials`) and returns:

```json
{ "error": "Access denied: endpoint blocked by security profile", "code": "SECURITY_PROFILE_DENIED" }
```

Read endpoints (`GET /v1/providers`, `GET /v1/models`) remain open under `restricted`.

### MCP Enforcement

Under non-`local-dev` profiles, `ListTools` returns only tools in the allowed categories. `CallTool` is authorized before execution. Rate limiting is applied per profile.

## Approval Flows

Destructive MCP tools can be paused for explicit human approval when the security profile is not `local-dev`.

### How It Works

1. Client calls a destructive tool (e.g., `vault_store`).
2. If approval is required, the gateway returns an `approvalRequired` payload with a `requestId`.
3. Admin reviews pending requests via `GET /v1/approvals` or `approval_list` MCP tool.
4. Admin approves or denies via `POST /v1/approvals/:id/approve` or `approval_approve` MCP tool.
5. Original tool executes only after approval.

### Auto-Approve List

Read-only tools (`file_read`, `search`, `list`, `vault_list`) bypass approval automatically.

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/approvals` | GET | List pending approval requests |
| `/v1/approvals/:id/approve` | POST | Approve a request |
| `/v1/approvals/:id/deny` | POST | Deny a request |

### MCP Tools

| Tool | Description |
|------|-------------|
| `approval_list` | List pending requests |
| `approval_approve` | Approve by request ID |
| `approval_deny` | Deny by request ID |

## Three-Part Prompt

The three-part prompt pattern separates prompts into `system` (role/constraints), `context` (background data), and `instruction` (the actual task). Research shows measurable quality improvement, especially with smaller models.

### HTTP API

Both `/v1/generate` and `/v1/chat/completions` accept the three fields:

```bash
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "system": "You are a code reviewer.",
    "context": "We use Zod 4 and Hono.",
    "instruction": "Review this schema for edge cases."
  }'
```

Legacy flat `prompt` is still accepted and auto-detected when `system`/`context`/`instruction` are absent.

### MCP Schema

The `llm_generate` tool exposes `system`, `context`, and `instruction` as optional fields alongside the legacy `prompt`:

```json
{
  "system": "You are a helpful assistant.",
  "context": "The project uses TypeScript.",
  "instruction": "Explain strict mode benefits."
}
```

### Enable/Disable

```bash
OPTIMIZE_MESSAGES_ENABLED=true   # default: true
```

## RTK Output Compression

RTK-style compression strips redundant content from tool call results before passing them to LLMs. This saves token budget on large structured outputs.

### Strategies

1. **Filter** — remove noise fields (`created_at`, `id`, `etag`, etc.)
2. **Group** — merge repeated similar entries into count + sample
3. **Truncate** — enforce max length on string values
4. **Deduplicate** — remove exact-duplicate array entries

### Configuration

```bash
ENABLE_OUTPUT_COMPRESSION=true   # default: true
```

### Analytics Endpoint

```bash
curl http://localhost:3456/v1/compression/stats \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

```json
{ "totalCalls": 42, "compressedCalls": 42, "avgRatio": 0.65, "totalSavingsChars": 15200 }
```

## Local LLM Offloading

Offloadable tasks (summarization, formatting, classification) can be routed to local runtimes (Ollama, LM Studio) instead of cloud providers, saving 86–95% of API token cost.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_LLM_ENABLED` | `false` | Enable local LLM routing |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `LM_STUDIO_URL` | `http://localhost:1234` | LM Studio API endpoint |

### Detection

At startup, the gateway probes both backends. Models are listed at:

```bash
curl http://localhost:3456/v1/local/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

### Fallback

If the local LLM fails or the task is not offloadable, the gateway falls back to cloud providers automatically and emits a metric.

### MCP Tool

| Tool | Description |
|------|-------------|
| `local_llm_generate` | Generate via local LLM with offload detection |

## Model Routing

Model routing adds task-aware provider selection that classifies each prompt and routes it to the optimal endpoint based on configured rules, cost tiers, and quality thresholds.

### What It Does

- **Classifies** incoming prompts into task types (`code`, `analysis`, `chat`, `reasoning`, etc.)
- **Matches** the task against routing rules defined in `model-routing.json`
- **Selects** the cheapest available endpoint that meets quality requirements
- **Falls back** to more expensive endpoints if quality drops below threshold
- **Learns** from feedback — records success/failure per endpoint+task for adaptive routing

### Enable

```bash
MODEL_ROUTING_ENABLED=true
```

When enabled, the precedence stack becomes:

1. Session stickiness
2. Group-based routing
3. **ModelRouter** (task-aware selection)
4. Local-LLM offloading (only if ModelRouter is disabled or returns no match)
5. Standard resolution (model match → provider preference → API before CLI)
6. Latency reordering

### Configuration

Create `model-routing.json` in the project root. The gateway loads it at startup.

```json
{
  "enabled": true,
  "endpoints": [...],
  "rules": [...],
  "defaultEndpoint": "opencode-cli-default",
  "qualityThreshold": 0.7,
  "qualityWindowSize": 50
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether model routing is active |
| `endpoints` | array | Available model endpoints with cost tier and capabilities |
| `rules` | array | Task-to-endpoint routing rules (first match wins) |
| `defaultEndpoint` | string | Fallback endpoint ID when no rule matches |
| `qualityThreshold` | number | Minimum acceptable quality rate (0–1) |
| `qualityWindowSize` | number | Number of recent requests to track per endpoint+task |

**Endpoint fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique endpoint identifier |
| `providerId` | string | Provider ID (e.g., `anthropic`, `openai`, `opencode-cli`) |
| `model` | string | Model ID for API calls |
| `costTier` | string | `free`, `cheap`, `standard`, or `expensive` |
| `capabilities` | array | Capability tags (e.g., `chat`, `code`, `reasoning`) |
| `maxTokens` | number | Maximum context window in tokens |

**Rule fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique rule identifier |
| `taskType` | string | Task type to match, or `*` for wildcard |
| `preferredEndpoints` | array | Ordered list of endpoint IDs to try |
| `maxCostTier` | string | Most expensive tier allowed for this task |
| `minQuality` | string | Minimum quality level: `low`, `medium`, `high`, `critical` |
| `allowFallback` | boolean | Whether to fall back to default endpoint if all preferred fail |

### Example Task-to-Endpoint Mappings

| Task Type | Preferred Endpoints | Cost Cap | Min Quality |
|-----------|---------------------|----------|-------------|
| `code` | Claude Sonnet → GPT-4.1 | `expensive` | `high` |
| `analysis` | Claude Sonnet → GPT-4.1 | `expensive` | `high` |
| `chat` | GPT-4.1-mini → OpenCode CLI | `standard` | `medium` |
| `reasoning` | GPT-4.1 → Claude Sonnet | `expensive` | `critical` |
| `*` (default) | OpenCode CLI → GPT-4.1-mini | `standard` | `low` |

### Coexistence with Local-LLM Offloading

Local-LLM offloading and model routing work together with clear precedence:

- **ModelRouter runs first.** If it selects an endpoint, that provider is promoted to the top of the candidate list.
- **Local-LLM offloading runs only when ModelRouter is disabled or returns no match.** This prevents conflicts: explicit routing rules always beat heuristic offloading.

If you want local models in your routing mix, register them as endpoints with `"costTier": "free"` and include them in rule `preferredEndpoints`.

### Example File

See `model-routing.example.json` in the repository root for a full template with multiple endpoints and routing rules.

## HF Auto-Discovery

At startup (when enabled), the gateway scans local backends and enriches detected models with HuggingFace metadata (tags, pipeline type, recommended tasks).

### Configuration

```bash
AUTO_DISCOVER_MODELS=true   # default: false
HF_TOKEN=hf_xxxxxxxxxx       # optional, for private repos
```

### Admin Endpoint

Trigger discovery on demand:

```bash
curl -X POST http://localhost:3456/v1/admin/discover \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ "hfToken": "optional-override" }'
```

Response:

```json
{
  "ok": true,
  "backendsScanned": ["ollama", "lm-studio"],
  "models": [...],
  "enrichedCount": 3,
  "unenrichedCount": 1
}
```

### Cache

Enriched metadata is persisted to SQLite (`hf_model_cache` table) so subsequent startups are fast even without HF API access.

## Architecture

```text
Clients (GHAGGA, OpenCode, curl, LangChain, any OpenAI-compatible tool)
    |
    |  POST /v1/chat/completions  |  POST /v1/generate  |  MCP stdio
    v
+-------------------------------------------------------------------+
|                    MCP LLM Bridge (Hono + MCP)                    |
|                                                                   |
|  HTTP Server                       MCP Server                     |
|  - /v1/chat/completions            - llm_generate                 |
|  - /v1/generate                    - vault_*                      |
|  - /v1/models                      - code_search                  |
|  - /v1/providers                   - index_codebase               |
|  - /v1/credentials CRUD            - shared_state                 |
|  - /v1/files CRUD                  - usage_*                      |
|  - /v1/groups CRUD                 - circuit_breaker_*            |
|  - /metrics /health                - group tools                  |
|  - /v1/compression/stats           - approval_*                   |
|  - /v1/local/models                - local_llm_generate           |
|  - /v1/admin/discover              - discover_models              |
+-------------------------------------------------------------------+
|  Bridge routing         | Context compression | Code search        |
|  Provider groups        | Cost tracking       | CRDT state         |
|  Security profiles      | Approval flows      | Local LLM          |
|  HF discovery           | Three-part prompt   | Output compression |
+-------------------------+---------------------+--------------------+
| Router (model -> provider)       | Vault (AES-256-GCM + SQLite)   |
+-------------------------+---------------------+--------------------+
    |                                                  |
    v                                                  v
  API providers                                   CLI providers
  Anthropic, OpenAI, Google, Groq, OpenRouter     OpenCode, Claude,
                                                   Gemini, Codex, Qwen, Copilot
```

### Design Notes

- Hono keeps the HTTP layer small and fast.
- `better-sqlite3` keeps the vault single-file and operationally simple.
- SQLite WAL mode improves concurrent read behavior.
- API providers are preferred before CLI providers unless bridge logic says otherwise.
- Vault writes use upsert semantics for repeatable automation.
- CLI adapters materialize auth files into temp homes and clean them up in `finally` blocks.
- Bridge routing is intentionally optional and file-driven.
- Code search stays in-memory for speed and freshness.
- CRDTs reduce coordination pain for parallel agent workflows.

### Experimental Modules

- **`src/workflow-builder/builder.ts`** — DAG-based workflow engine for MCP tool orchestration.  
  Exports: `createWorkflow`, `addNode`, `addEdge`, `validateWorkflow`, `getExecutionOrder`, `createExecution`, `serializeWorkflow`, `deserializeWorkflow`.  
  Not yet wired to HTTP or MCP. Use programmatically if you want to experiment with visual workflow definitions.

### Session Systems

The gateway has two separate session systems by design:

1. **SessionStore** (`src/core/session.ts`) — Router-level provider pinning.  
   Tracks which provider+key a specific client+model combo should use.  
   Used by the Router for low-level request-to-provider stickiness.

2. **SessionManager** (`src/session/session-manager.ts`) — Group-level sticky routing.  
   Manages session affinity for multi-turn conversations via TTL-based tracking.  
   Used by GroupManager for group-based sticky routing and dashboard metrics.

They are separate by design: `SessionStore` operates at the Router layer (provider selection), while `SessionManager` operates at the Group layer (conversation continuity).  
Do not conflate them.

`GET /v1/admin/sessions` reports them separately for that reason:

- `routerStickySessions` comes from `SessionStore` and reflects the pins the Router actually uses at request time.
- `groupSessions` comes from `SessionManager` and reflects group-level session affinity metrics.
- The endpoint includes a `note` explaining the split so the dashboard does not imply a single shared session pool.

## Security

- AES-256-GCM encryption for stored keys and auth files
- constant-time bearer-token comparison
- master key file stored with mode `0600`
- config directory created with mode `0700`
- credentials are never returned raw from listing endpoints
- temp auth files are cleaned up after CLI invocations
- minimum 32-character auth token requirement
- public `/health` endpoint for safe monitoring

## Development

```bash
pnpm run dev
pnpm run serve
pnpm run start
pnpm test
pnpm run typecheck
pnpm run build
```

### Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `tsx src/index.ts` | MCP stdio mode |
| `dev` | `tsx watch src/index.ts` | local development |
| `serve` | `tsx src/index.ts serve` | HTTP server and dashboard |
| `test` | `node --import tsx --import ./test/setup/inject-require.mjs --test test/*.test.ts test/**/*.test.ts` | test suite |
| `build` | `tsup src/index.ts --format esm --dts` | production build |
| `typecheck` | `tsc --noEmit` | TypeScript checking |

### Requirements

- Node.js 22+
- pnpm 9+

## License

MIT
