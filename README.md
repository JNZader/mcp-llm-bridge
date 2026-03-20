# LLM Gateway

A centralized LLM credential management and routing service. One service handles all your API keys, auth files, and model routing — every project just calls it.

- **10 provider adapters** (5 API + 5 CLI)
- **80+ models** including 68 via OpenCode CLI
- **OpenAI-compatible API** — works with any tool that speaks OpenAI format
- **Encrypted credential vault** — AES-256-GCM in SQLite
- **Per-project credential scoping** — isolate keys by project with global fallback
- **Bearer token authentication** — secure your gateway in production
- **Web dashboard** — manage everything from the browser
- **MCP server** — use directly from Claude Code via stdio
- **Docker ready** — deploy anywhere with persistent volumes

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Dashboard](#dashboard)
3. [API Reference](#api-reference)
4. [Providers](#providers)
5. [Authentication](#authentication)
6. [Credential Management](#credential-management)
7. [Using with OpenCode](#using-with-opencode)
8. [Using with GHAGGA](#using-with-ghagga)
9. [Using with Any OpenAI-Compatible Tool](#using-with-any-openai-compatible-tool)
10. [Docker Deployment](#docker-deployment)
11. [MCP Server](#mcp-server)
12. [Configuration](#configuration)
13. [Architecture](#architecture)
14. [Security](#security)
15. [Development](#development)

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the HTTP server + dashboard
pnpm run serve

# Open the dashboard
open http://localhost:3456
```

Add your API keys through the dashboard or via curl:

```bash
# Store an Anthropic API key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider": "anthropic", "apiKey": "sk-ant-..."}'

# Generate text
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Explain quicksort in one paragraph"}'
```

---

## Dashboard

The gateway includes a full admin dashboard for managing credentials, providers, models, and testing generation.

**Hosted version:** [https://jnzader.github.io/mcp-llm-bridge/](https://jnzader.github.io/mcp-llm-bridge/)

**Self-hosted:** Available at `http://localhost:3456` when the gateway is running.

### First-time setup

1. Open the dashboard
2. Click the **Settings** gear icon
3. Enter your **API Base URL** (e.g., `https://llm-gateway.yourdomain.com` or `http://localhost:3456`)
4. Enter your **Auth Token** (if configured)
5. Click **Test Connection**, then **Save & Connect**

### Dashboard features

- **Credentials** — Add, view (masked), filter by project, and delete API keys
- **Auth Files** — Upload and manage auth files (auth.json, .credentials.json)
- **Providers** — See which providers are available with status indicators
- **Models** — Browse all available models grouped by provider
- **Test Generation** — Send prompts directly, select provider/model/project, view response metadata

---

## API Reference

All `/v1/*` endpoints require a bearer token when `LLM_GATEWAY_AUTH_TOKEN` is set. Include it as:

```
Authorization: Bearer <your-token>
```

### OpenAI-Compatible Endpoints

These endpoints follow the OpenAI API format, making the gateway a drop-in replacement for any tool that speaks OpenAI.

#### `POST /v1/chat/completions`

Standard OpenAI chat completions format. Supports system messages, conversation history, model selection, and temperature.

The response stays OpenAI-compatible and adds an `x_gateway` object with resolution metadata so clients can tell what actually answered, including fallback usage.

> **Note:** Streaming (`stream: true`) is not supported.

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "max_tokens": 1024
  }'
```

Response:

```json
{
  "id": "chatcmpl-<uuid>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "claude-sonnet-4-20250514",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "The capital of France is Paris." },
    "finish_reason": "stop"
  }],
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

#### `GET /v1/models`

List available models in OpenAI format. Only shows models from providers that have credentials configured.

```bash
curl http://localhost:3456/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

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

### Gateway Native Endpoints

#### `POST /v1/generate`

The gateway's native generation endpoint. Supports provider/model selection and per-project scoping.

Responses include both the backward-compatible `provider` / `model` fields and richer routing metadata so callers can distinguish requested values from the provider/model that actually answered.

```bash
# Auto-select provider
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"prompt": "Explain quicksort in one paragraph"}'

# Specify provider and model
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "prompt": "Write a haiku about Rust",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "maxTokens": 256,
    "system": "You are a poet.",
    "project": "my-project"
  }'
```

Request body:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The user prompt |
| `system` | string | No | System prompt |
| `provider` | string | No | Preferred provider ID |
| `model` | string | No | Specific model ID |
| `maxTokens` | number | No | Max output tokens (default: 4096) |
| `project` | string | No | Project scope for credential resolution |

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

#### `GET /v1/providers`

List all registered providers with their availability status.

```bash
curl http://localhost:3456/v1/providers \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

```json
{
  "providers": [
    { "id": "anthropic", "name": "Anthropic", "type": "api", "available": true },
    { "id": "openai", "name": "OpenAI", "type": "api", "available": false },
    { "id": "opencode-cli", "name": "OpenCode CLI", "type": "cli", "available": true }
  ]
}
```

#### `POST /v1/credentials`

Store an API key in the encrypted vault. Upserts by (provider, keyName, project).

```bash
# Store a global credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider": "anthropic",
    "keyName": "default",
    "apiKey": "sk-ant-api03-..."
  }'

# Store a project-scoped credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider": "openai",
    "keyName": "default",
    "apiKey": "sk-proj-...",
    "project": "my-app"
  }'
```

Response (201):

```json
{ "id": 1, "provider": "anthropic", "keyName": "default", "project": "_global" }
```

#### `GET /v1/credentials`

List all stored credentials with masked values. Optionally filter by project.

```bash
# List all
curl http://localhost:3456/v1/credentials \
  -H 'Authorization: Bearer YOUR_TOKEN'

# Filter by project (returns project-specific + global)
curl 'http://localhost:3456/v1/credentials?project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

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

#### `DELETE /v1/credentials/:id`

Remove a stored credential by its row ID.

```bash
curl -X DELETE http://localhost:3456/v1/credentials/1 \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

```json
{ "ok": true }
```

#### `POST /v1/files`

Upload an auth file (e.g., `auth.json`, `.credentials.json`) to the encrypted vault. Upserts by (provider, fileName, project).

```bash
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider": "opencode",
    "fileName": "auth.json",
    "content": "{\"token\": \"oc-...\"}",
    "project": "_global"
  }'
```

Response (201):

```json
{ "id": 1, "provider": "opencode", "fileName": "auth.json", "project": "_global" }
```

#### `GET /v1/files`

List all stored auth files (metadata only, no content). Optionally filter by project.

```bash
curl http://localhost:3456/v1/files \
  -H 'Authorization: Bearer YOUR_TOKEN'

curl 'http://localhost:3456/v1/files?project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

```json
{
  "files": [
    { "id": 1, "provider": "opencode", "fileName": "auth.json", "project": "_global", "createdAt": "2025-01-15" }
  ]
}
```

#### `DELETE /v1/files/:id`

Remove a stored auth file by its row ID.

```bash
curl -X DELETE http://localhost:3456/v1/files/1 \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Response:

```json
{ "ok": true }
```

#### `GET /health`

Health check endpoint. **Always public** — no authentication required. Used by Coolify, uptime monitors, and load balancers.

```bash
curl http://localhost:3456/health
```

Response:

```json
{ "status": "ok", "version": "0.2.0" }
```

---

## Providers

### API Providers (Direct SDK)

API providers use official SDKs to call LLM APIs directly. They require an API key stored in the vault.

| Provider | ID | Auth | Models |
|----------|-----|------|--------|
| **Anthropic** | `anthropic` | API Key | `claude-sonnet-4-20250514`, `claude-haiku-4-20250414` |
| **OpenAI** | `openai` | API Key | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| **Google** | `google` | API Key | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash` |
| **Groq** | `groq` | API Key | `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |
| **OpenRouter** | `openrouter` | API Key | `deepseek/deepseek-chat`, `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `google/gemini-2.5-flash` |

### CLI Providers (Local CLI Tools)

CLI providers wrap locally installed command-line tools. They act as fallbacks when API providers are unavailable.

| Provider | ID | CLI Command | Auth | Models |
|----------|-----|-------------|------|--------|
| **OpenCode CLI** | `opencode-cli` | `opencode` | `auth.json` (vault) | 68 models (free + subscription) |
| **Claude CLI** | `claude-cli` | `claude` | `.credentials.json` (vault) | `claude-sonnet-4-5`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5` |
| **Gemini CLI** | `gemini-cli` | `gemini` | CLI auth | `gemini-cli` |
| **Codex CLI** | `codex-cli` | `codex` | CLI auth | `codex-cli` |
| **Copilot CLI** | `copilot-cli` | `copilot` | CLI auth | `copilot-cli` |

### OpenCode CLI Models (68 models)

OpenCode provides access to a large catalog of models through its subscription service:

**Free tier** (`opencode/*`): `big-pickle`, `gpt-5-nano`, `mimo-v2-omni-free`, `mimo-v2-pro-free`, `minimax-m2.5-free`, `nemotron-3-super-free`

**OpenCode Go** (`opencode-go/*`): `glm-5`, `kimi-k2.5`, `minimax-m2.5`, `minimax-m2.7`

**Anthropic** (`anthropic/*`): Claude 3 through 4.6 — Haiku, Sonnet, and Opus variants (20+ models)

**GitHub Copilot** (`github-copilot/*`): Claude, Gemini, GPT, and Grok models routed through Copilot (25+ models)

**OpenAI** (`openai/*`): Codex Mini, GPT-5 through GPT-5.4 series (10+ models)

### Provider Priority

When no specific provider or model is requested:

1. **API providers first** — Anthropic, OpenAI, Google, Groq, OpenRouter (in registration order)
2. **CLI providers second** — OpenCode, Claude, Gemini, Codex, Copilot

When a model is specified, the provider that owns that model is tried first, with others as fallback.

---

## Authentication

### Bearer Token

Set the `LLM_GATEWAY_AUTH_TOKEN` environment variable to enable authentication:

```bash
# Generate a secure token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set it
export LLM_GATEWAY_AUTH_TOKEN="your-64-char-hex-token"
```

The token must be at least 32 characters.

### Auth Rules

| Path | Auth Required |
|------|:------------:|
| `GET /health` | No |
| `GET /` (dashboard HTML) | No |
| `OPTIONS *` (CORS preflight) | No |
| All `/v1/*` endpoints | Yes |

If `LLM_GATEWAY_AUTH_TOKEN` is not set, auth is disabled entirely (suitable for local development only).

The gateway uses **constant-time comparison** (`timingSafeEqual`) for token validation to prevent timing attacks.

### Per-Request Project Scoping

Requests can specify a project scope for credential resolution in two ways:

1. **Body field:** `"project": "my-app"` in the JSON request body
2. **Header:** `X-Project: my-app`

Body field takes priority over the header.

---

## Credential Management

### API Keys

API keys are encrypted with **AES-256-GCM** and stored in an SQLite database.

```bash
# Store a global key (available to all projects)
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"provider": "anthropic", "apiKey": "sk-ant-..."}'

# Store a project-scoped key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"provider": "anthropic", "apiKey": "sk-ant-project-...", "project": "my-app"}'
```

### Auth Files

CLI providers like OpenCode and Claude CLI use auth files instead of API keys. These are also encrypted and stored in the vault.

```bash
# Store an OpenCode auth.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider": "opencode",
    "fileName": "auth.json",
    "content": "{\"token\": \"oc-...\"}"
  }'

# Store a Claude CLI .credentials.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider": "claude",
    "fileName": ".credentials.json",
    "content": "{\"claudeAiOauth\":{...}}"
  }'
```

### Credential Resolution

When a request specifies a `project`:

1. **Project-specific credential** is tried first
2. **Global credential** (`_global`) is used as fallback

This lets you use different API keys per project while maintaining a shared default.

---

## Using with OpenCode

[OpenCode](https://github.com/anomalyco/opencode) supports custom providers. Configure it to use the LLM Gateway as a backend:

### 1. Create `opencode.json` in your project root

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

### 2. Set environment variable

```bash
export LLM_GATEWAY_TOKEN="your-gateway-auth-token"
```

### 3. Run OpenCode

```bash
opencode
# Use /models to select a gateway model
```

---

## Using with GHAGGA

[GHAGGA](https://github.com/JNZader/ghagga) is a multi-agent AI code review system that supports the LLM Gateway as a provider.

1. Open the GHAGGA dashboard
2. Select **"LLM Gateway"** as the provider
3. Enter your gateway URL (e.g., `https://llm-gateway.yourdomain.com`)
4. Enter your gateway auth token
5. Select a model from the available list

GHAGGA supports three review modes through the gateway:

- **Simple** — single-agent review
- **Workflow** — 5-agent pipeline review
- **Consensus** — 3-stance deliberation review

---

## Using with Any OpenAI-Compatible Tool

Since the gateway exposes `/v1/chat/completions` and `/v1/models` in standard OpenAI format, **any tool that speaks the OpenAI API can use it as a backend**.

### General Configuration

Point your tool at the gateway:

| Setting | Value |
|---------|-------|
| **Base URL** | `https://llm-gateway.yourdomain.com/v1` |
| **API Key** | Your `LLM_GATEWAY_AUTH_TOKEN` value |

### Compatible tools

- **LangChain** — set `base_url` in the OpenAI client
- **LlamaIndex** — configure custom OpenAI endpoint
- **Cursor** — add as custom OpenAI-compatible model
- **Continue** — add as OpenAI provider with custom base URL
- **Any HTTP client** — just POST to `/v1/chat/completions`

### LangChain Example (Python)

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

### LangChain Example (TypeScript)

```typescript
import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
  configuration: {
    baseURL: "https://llm-gateway.yourdomain.com/v1",
  },
  apiKey: "your-gateway-token",
  model: "claude-sonnet-4-20250514",
});

const response = await llm.invoke("Explain quicksort");
```

---

## Docker Deployment

### Docker Compose (recommended)

```yaml
# docker-compose.yml
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

The `llm-data` volume persists the SQLite vault database and master key between container restarts.

### Docker Build & Run

```bash
docker build -t llm-gateway .
docker run -d \
  -p 3456:3456 \
  -v llm-data:/root/.llm-gateway \
  -e LLM_GATEWAY_AUTH_TOKEN="your-token" \
  llm-gateway
```

### What's in the Docker image

The Dockerfile (based on `node:22-slim`) includes:

- **pnpm 9** — package manager
- **OpenCode CLI** — pre-installed binary for CLI adapter support
- **Claude CLI** (`@anthropic-ai/claude-code`) — pre-installed for Claude Max subscription support

### Coolify Deployment

Deploy directly from the repository:

1. Create a new service in Coolify pointing to your repository
2. Set the build pack to **Dockerfile**
3. Configure environment variables:
   - `LLM_GATEWAY_PORT=3456`
   - `LLM_GATEWAY_AUTH_TOKEN=<your-token>`
   - `LLM_GATEWAY_MASTER_KEY=<your-hex-key>` (optional — auto-generated if not set)
4. Add a persistent volume mapping to `/root/.llm-gateway`
5. Set the health check endpoint to `/health`

---

## MCP Server

The gateway works as an **MCP server** via stdio transport, allowing Claude Code and Claude Desktop to use it directly.

### MCP Tools

| Tool | Description |
|------|-------------|
| `llm_generate` | Generate text with automatic provider routing and fallback |
| `llm_models` | List all available models across providers |
| `vault_store` | Store an API key in the encrypted vault |
| `vault_list` | List stored credentials (masked values) |
| `vault_delete` | Delete a stored credential by ID |
| `vault_store_file` | Store an auth file (e.g., auth.json) in the vault |
| `vault_list_files` | List stored auth files (metadata only) |
| `vault_delete_file` | Delete a stored auth file by ID |

### Claude Code Configuration

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

Or if running from the project directory:

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

### Claude Desktop Configuration

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

> **Note:** MCP stdio has no authentication — it runs as a local process. The HTTP server and MCP server share the same Router and Vault instances.

---

## Configuration

All configuration is done through environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_GATEWAY_PORT` | `3456` | HTTP server port |
| `LLM_GATEWAY_MASTER_KEY` | auto-generated | Master encryption key (64-char hex string, 32 bytes). If not set, a key is auto-generated and stored at `~/.llm-gateway/master.key` with mode `0600`. |
| `LLM_GATEWAY_DB_PATH` | `~/.llm-gateway/vault.db` | Path to the SQLite credential vault database |
| `LLM_GATEWAY_AUTH_TOKEN` | *(none)* | Bearer token for HTTP API authentication. Must be at least 32 characters. If not set, auth is disabled. |

### Master Key Priority

1. `LLM_GATEWAY_MASTER_KEY` environment variable (hex-encoded)
2. Existing key file at `~/.llm-gateway/master.key`
3. Auto-generate a new key and save to file

> **Important:** If you lose the master key, all stored credentials become unrecoverable. Back up your master key or set it explicitly via the environment variable in production.

---

## Architecture

```
Clients (GHAGGA, OpenCode, curl, LangChain, any OpenAI-compatible tool)
    |
    |  POST /v1/chat/completions  (OpenAI format)
    |  POST /v1/generate          (native format)
    |  MCP stdio                  (Claude Code)
    v
+---------------------------------------------------+
|              LLM Gateway (Hono + MCP)              |
|                                                    |
|  HTTP Server (Hono)          MCP Server (stdio)    |
|  - /v1/chat/completions      - llm_generate        |
|  - /v1/generate              - vault_store          |
|  - /v1/models                - vault_list           |
|  - /v1/providers             - vault_delete         |
|  - /v1/credentials CRUD      - llm_models           |
|  - /v1/files CRUD            - vault_store_file     |
|  - /health                   - vault_list_files     |
|                              - vault_delete_file    |
+----------------------------+-----------------------+
|          Router (model -> provider selection)       |
|          Vault  (AES-256-GCM encrypted SQLite)      |
+----------------------------+-----------------------+
    |                                    |
    v                                    v
API Providers                    CLI Providers
- Anthropic (SDK)                - OpenCode CLI
- OpenAI (SDK)                   - Claude CLI
- Google (SDK)                   - Gemini CLI
- Groq (SDK)                     - Codex CLI
- OpenRouter (SDK)               - Copilot CLI
    |                                    |
    v                                    v
LLM APIs                        Local CLI tools
```

### Key Design Decisions

- **Hono** for the HTTP server — lightweight, fast, middleware-based
- **better-sqlite3** for the vault — synchronous, single-file, no server needed
- **WAL mode** enabled on SQLite for better concurrent read performance
- **API providers always tried before CLI** — CLI acts as a fallback layer
- **Upsert semantics** — storing a credential with the same (provider, keyName, project) updates it
- **Temp file cleanup** — CLI adapters write auth files to temp directories and clean up in `finally` blocks

---

## Security

- **AES-256-GCM encryption** for all stored credentials and auth files
- **Bearer token authentication** with constant-time comparison (`timingSafeEqual`) to prevent timing attacks
- **Master key file** stored with mode `0600` (owner read/write only)
- **Config directory** created with mode `0700` (owner access only)
- **CORS enabled** with `origin: '*'` for dashboard access from GitHub Pages
- **Credentials never logged** — masked output only
- **Temp files cleaned up** in `finally` blocks after CLI invocations
- **Minimum token length** enforced (32 characters) to prevent weak secrets
- **Health endpoint always public** — allows monitoring without exposing credentials

---

## Development

```bash
# Run in development mode (auto-reload on file changes)
pnpm run dev

# Start the HTTP server (production-like)
pnpm run serve

# MCP mode (stdio — used by Claude Code)
pnpm run start

# Type check
pnpm run typecheck

# Run tests
pnpm test

# Build for distribution
pnpm run build
```

### npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `tsx src/index.ts` | Start MCP server (stdio mode) |
| `dev` | `tsx watch src/index.ts` | Development with auto-reload |
| `serve` | `tsx src/index.ts serve` | Start HTTP server + dashboard |
| `test` | `tsx --test test/*.test.ts` | Run tests |
| `build` | `tsup src/index.ts --format esm --dts` | Build for distribution |
| `typecheck` | `tsc --noEmit` | TypeScript type checking |

### Requirements

- Node.js 22+
- pnpm 9+

---

## License

MIT
