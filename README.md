<div align="center">

# 🌉 MCP LLM Bridge

**Centralized LLM Gateway — 10 Providers, 80+ Models, One Endpoint**

Route all your LLM calls through a single encrypted gateway.
Manage API keys, auth files, and model routing from one service — every project just calls it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://docs.docker.com/)

<!-- TODO: Add hero image here — dashboard overview showing providers, models, and credential management (1200x630px) -->

</div>

## ✨ Features

🔐 **Encrypted Vault** — AES-256-GCM encryption for all API keys and auth files in SQLite  
🌉 **10 Provider Adapters** — 5 API (Anthropic, OpenAI, Google, Groq, OpenRouter) + 5 CLI (OpenCode, Claude, Gemini, Codex, Copilot)  
🤖 **80+ Models** — including 68 via OpenCode CLI subscription routing  
🔄 **OpenAI-Compatible API** — drop-in replacement for any tool that speaks OpenAI format  
🛡️ **Bearer Token Auth** — secure your gateway with constant-time comparison  
📊 **Web Dashboard** — manage credentials, providers, and test generation from the browser  
🧩 **MCP Server** — use directly from Claude Code via stdio  
🔀 **Cross-Model Bridge** — task-aware routing with fallback chains across providers  
🗜️ **Context Compression** — background extractive, structural, and token-budget compression with LRU cache  
🔍 **Semantic Code Search** — regex chunking, trigram fuzzy search, and multi-hop import resolution  
🤝 **CRDT Multi-Agent State** — conflict-free replicated data types for concurrent agent collaboration  
📊 **OpenTelemetry & Prometheus** — full tracing and metrics out of the box  

## 🚀 Live Demo

**[https://gateway.javierzader.com](https://gateway.javierzader.com)** — Try the gateway instantly. No setup required.

<!-- TODO: Add screenshot here — Dashboard overview showing provider status, credential count, and model list -->
<!-- TODO: Add screenshot here — Provider management view with status indicators and available models -->
<!-- TODO: Add screenshot here — API usage charts, generation history, and response metadata -->

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | Node.js 22+, TypeScript 5.7 |
| **HTTP** | Hono |
| **Database** | Better-SQLite3 (WAL mode) |
| **Encryption** | AES-256-GCM (Node.js crypto) |
| **LLM SDKs** | Anthropic SDK, OpenAI SDK |
| **Validation** | Zod 4 |
| **Observability** | OpenTelemetry, Pino, Prometheus |
| **Protocol** | MCP (Model Context Protocol) via stdio |
| **Distribution** | Docker, npm, pnpm |

---

## ⚡ Quick Start

```bash
pnpm install && pnpm run serve    # Install and start
open http://localhost:3456        # Open dashboard

# Store an API key and generate text
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider": "anthropic", "apiKey": "sk-ant-..."}'

curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Explain quicksort in one paragraph"}'
```

---

## 📡 API Reference

All `/v1/*` endpoints require a Bearer token when `LLM_GATEWAY_AUTH_TOKEN` is set.

### OpenAI-Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-format chat completions (non-streaming) |
| `/v1/models` | GET | List available models in OpenAI format |
| `/v1/generate` | POST | Native generation with provider/model selection |
| `/v1/providers` | GET | List all providers with availability status |

### Credential Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/credentials` | POST | Store API key (upsert by provider/keyName/project) |
| `/v1/credentials` | GET | List credentials (masked values, filterable by project) |
| `/v1/credentials/:id` | DELETE | Remove a credential by ID |
| `/v1/files` | POST | Upload auth file to encrypted vault |
| `/v1/files` | GET | List stored auth files (metadata only) |
| `/v1/files/:id` | DELETE | Remove an auth file by ID |
| `/health` | GET | Health check (always public, no auth required) |

### Generation Response Metadata

Every response includes an `x_gateway` object with routing details:

```json
{
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

---

## 🏢 Providers

### API Providers (Direct SDK)

| Provider | ID | Models |
|----------|-----|--------|
| **Anthropic** | `anthropic` | Claude Sonnet 4, Haiku 4, Opus 4 |
| **OpenAI** | `openai` | GPT-4o, GPT-4o-mini, o3-mini |
| **Google** | `google` | Gemini 2.5 Pro/Flash |
| **Groq** | `groq` | Llama 3.3 70B, Llama 3.1 8B |
| **OpenRouter** | `openrouter` | DeepSeek, Claude, GPT-4o, Gemini via router |

### CLI Providers (Local CLI Tools)

| Provider | ID | Models |
|----------|-----|--------|
| **OpenCode CLI** | `opencode-cli` | 68 models (free + subscription) |
| **Claude CLI** | `claude-cli` | Sonnet 4, Opus 4, Haiku 4 |
| **Gemini CLI** | `gemini-cli` | Gemini CLI |
| **Codex CLI** | `codex-cli` | Codex CLI |
| **Copilot CLI** | `copilot-cli` | Copilot CLI |

**Provider priority:** API providers first, CLI providers as fallback. When a model is specified, the owning provider is tried first with others as fallback chain.

---

## 🧩 MCP Server

Works as an MCP server via stdio — use directly from Claude Code or Claude Desktop.

| Tool | Description |
|------|-------------|
| `llm_generate` | Generate text with auto-routing and fallback |
| `llm_models` | List all available models |
| `vault_store` / `vault_list` / `vault_delete` | Manage API keys in encrypted vault |
| `vault_store_file` / `vault_list_files` / `vault_delete_file` | Manage auth files in vault |
| `code_search` / `index_codebase` | Semantic code search with fuzzy matching |
| `shared_state` | CRDT-based multi-agent state (read/write/merge/snapshot) |

**Claude Code config** — add to `~/.config/claude/mcp.json`:

```json
{ "mcpServers": { "llm-bridge": { "command": "mcp-llm-bridge" } } }
```

---

## 🔀 Cross-Model Bridge

Task-aware routing that classifies prompts and routes to the best provider:

| Task Type | Heuristic | Routes To |
|-----------|-----------|-----------|
| `large-context` | Tokens > 100K | Gemini CLI |
| `code-review` | Review keywords | Claude CLI |
| `fast-completion` | Short prompt (< 500 chars) | Groq |
| `default` | No match | Configured default |

Configure via `~/.llm-gateway/bridge.yaml`. Fallback chains are tried sequentially on failure.

---

## 🔐 Security

- **AES-256-GCM** encryption for all stored credentials and auth files
- **Constant-time token comparison** (`timingSafeEqual`) — prevents timing attacks
- **Master key** stored with mode `0600` (owner read/write only)
- **Credentials never logged** — masked output only
- **Temp file cleanup** in `finally` blocks after CLI invocations
- **Minimum 32-char token** length enforced
- **Health endpoint always public** — safe for load balancers

---

## 🔗 Integrations

### OpenCode

Add to `opencode.json` — point `baseURL` to your gateway and set `apiKey` to `env:LLM_GATEWAY_TOKEN`.

### Any OpenAI-Compatible Tool

`Base URL: https://gateway.javierzader.com/v1` | `API Key: your-gateway-token`

Compatible with **LangChain**, **LlamaIndex**, **Cursor**, **Continue**, and any HTTP client.

### GHAGGA

Select **"LLM Gateway"** in the [GHAGGA](https://github.com/JNZader/ghagga) dashboard → enter gateway URL + auth token → choose a model.

---

## 🏗️ Architecture

```
Clients (GHAGGA, OpenCode, curl, LangChain, any OpenAI-compatible tool)
    |
    |  POST /v1/chat/completions  |  POST /v1/generate  |  MCP stdio
    v
+-------------------------------------------------------------------+
|                    LLM Gateway (Hono + MCP)                        |
|  HTTP: /v1/* endpoints         |  MCP: llm_generate, vault_*,     |
|  Dashboard: /                   |    code_search, shared_state     |
+-------------------------------------------------------------------+
|  Bridge (task-aware routing)  |  Compression (LRU-cached)         |
|  Code Search (trigram index)  |  CRDT State (multi-agent)         |
+-----------------------------+-------------------------------------+
|          Router (model → provider)  |  Vault (AES-256-GCM, SQLite)  |
+-----------------------------+-------------------------------------+
    |                                    |
    v                                    v
 API Providers                     CLI Providers
 Anthropic · OpenAI · Google       OpenCode · Claude · Gemini
 Groq · OpenRouter                 Codex · Copilot
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_GATEWAY_PORT` | `3456` | HTTP server port |
| `LLM_GATEWAY_MASTER_KEY` | auto-generated | 64-char hex encryption key (32 bytes). Stored at `~/.llm-gateway/master.key` |
| `LLM_GATEWAY_DB_PATH` | `~/.llm-gateway/vault.db` | SQLite vault database path |
| `LLM_GATEWAY_AUTH_TOKEN` | *(none)* | Bearer token for API auth (min 32 chars). If unset, auth is disabled |

Bridge routing configured via `~/.llm-gateway/bridge.yaml` (see [Cross-Model Bridge](#-cross-model-bridge)).

### Per-Request Project Scoping

Requests can specify a project scope via body field `"project": "my-app"` or header `X-Project: my-app`. Project credentials take priority over global (`_global`) fallback.

---

## 🐳 Docker Deployment

```yaml
services:
  llm-gateway:
    build: .
    ports: ["3456:3456"]
    volumes: [llm-data:/root/.llm-gateway]
    environment:
      - LLM_GATEWAY_AUTH_TOKEN=your-secure-token-here
      - LLM_GATEWAY_MASTER_KEY=your-64-char-hex-key
volumes:
  llm-data:
```

Image based on `node:22-slim` with pnpm 9, OpenCode CLI, and Claude CLI pre-installed. Supports Coolify with `/health` as health check.

---

## 👨‍💻 Development

```bash
pnpm run dev          # Dev with auto-reload
pnpm run serve        # HTTP server + dashboard
pnpm run start        # MCP server (stdio for Claude Code)
pnpm test             # Run tests
pnpm run typecheck    # TypeScript checking
pnpm run build        # Build for distribution (tsup)
```

**Requirements:** Node.js 22+, pnpm 9+

## 📄 License

MIT