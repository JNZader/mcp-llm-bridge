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
- Includes task-aware bridge routing, project-scoped credentials with global fallback, semantic code search, context compression, and CRDT shared state.
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
15. [Architecture](#architecture)
16. [Security](#security)
17. [Development](#development)
18. [License](#license)

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

The code-search subsystem exposes semantic-ish symbol search through MCP.

It combines:

- regex-based chunking
- trigram fuzzy search
- symbol/content scoring
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
  "followImports": true
}
```

Returned results include file path, symbol name, kind, content, line numbers, score, and related chunks when import following is enabled.

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
+-------------------------------------------------------------------+
|  Bridge routing         | Context compression | Code search        |
|  Provider groups        | Cost tracking       | CRDT state         |
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
