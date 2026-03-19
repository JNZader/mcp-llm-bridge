# mcp-llm-bridge

A centralized LLM gateway that manages credentials and routes requests across multiple providers. Exposes both an MCP server (for Claude Code) and an HTTP API (for any project), with an admin dashboard for credential management.

**One service handles all your LLM credentials and routing — every project just calls it.**

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the HTTP server + admin dashboard
pnpm run serve

# Open the dashboard
open http://localhost:3456
```

Add your API keys through the dashboard or the API, then start generating.

## Supported Providers

### API Providers (direct SDK calls)

| Provider | ID | Models | Auth |
|----------|-----|--------|------|
| **Anthropic** | `anthropic` | claude-sonnet-4, claude-haiku-4 | API key |
| **OpenAI** | `openai` | gpt-4o, gpt-4o-mini, o3-mini | API key |
| **Google** | `google` | gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash | API key |
| **Groq** | `groq` | gpt-oss-120b, llama-3.3-70b-versatile, llama-3.1-8b-instant | API key |
| **OpenRouter** | `openrouter` | deepseek-chat, claude-sonnet-4, gpt-4o, gemini-2.5-flash | API key |

### CLI Providers (local CLI tools as fallback)

| Provider | ID | CLI Command | Priority |
|----------|-----|-------------|:--------:|
| **Claude Code** | `claude-cli` | `claude` | 1 |
| **Gemini CLI** | `gemini-cli` | `gemini` | 2 |
| **Codex CLI** | `codex-cli` | `codex` | 3 |
| **Copilot CLI** | `copilot-cli` | `copilot` | 4 |

API providers are always tried before CLI providers. Within each group, the order listed above determines priority.

## HTTP API

All endpoints are prefixed with `/v1`.

### Generate text

```bash
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Explain quicksort in one paragraph"}'
```

With provider and model selection:

```bash
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Write a haiku about Rust",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "maxTokens": 256
  }'
```

### List models

```bash
curl http://localhost:3456/v1/models
```

### List providers

```bash
curl http://localhost:3456/v1/providers
```

### Manage credentials

```bash
# Add a credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider": "anthropic", "keyName": "default", "apiKey": "sk-ant-..."}'

# List credentials (masked)
curl http://localhost:3456/v1/credentials

# Delete a credential
curl -X DELETE http://localhost:3456/v1/credentials/1
```

### Health check

```bash
curl http://localhost:3456/health
```

## MCP Tools

When used as an MCP server (via stdio), these tools are available:

| Tool | Description |
|------|-------------|
| `llm_generate` | Generate text with automatic provider routing and fallback |
| `llm_models` | List all available models across providers |
| `llm_providers` | Show provider status (available/unavailable) |
| `vault_store` | Store an API key in the encrypted vault |
| `vault_list` | List stored credentials (masked values) |
| `vault_delete` | Delete a stored credential |

### MCP Configuration

**Claude Code** — add to `~/.config/claude/mcp.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

## Admin Dashboard

The dashboard at `http://localhost:3456` provides:

- **Credential management** — add, view (masked), and delete API keys
- **Provider status** — see which providers are available
- **Model browser** — view all available models grouped by provider
- **Test generation** — send prompts and see responses with metadata

## Docker Deployment

### Docker Compose (recommended)

```bash
docker compose up -d
```

### Dockerfile

```bash
docker build -t llm-gateway .
docker run -p 3456:3456 -v llm-data:/root/.llm-gateway llm-gateway
```

### Coolify

Deploy directly from the repository. Set the following environment variable:

- `LLM_GATEWAY_PORT` — HTTP port (default: `3456`)
- `LLM_GATEWAY_MASTER_KEY` — 64-character hex string for credential encryption (auto-generated if not set)

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `LLM_GATEWAY_PORT` | `3456` | HTTP server port |
| `LLM_GATEWAY_MASTER_KEY` | auto-generated | Master encryption key (hex). If not set, one is generated and stored locally. |

## How It Works

1. **Credential vault** — API keys are encrypted with AES-256-GCM and stored in a local SQLite database
2. **Provider adapters** — each provider is a self-contained adapter that knows how to call its API
3. **Router** — selects the best provider based on request parameters, with automatic fallback
4. **Dual transport** — the same router serves both MCP (stdio) and HTTP (Hono) clients

## Development

```bash
# Run in development mode (with auto-reload)
pnpm run dev

# Type check
pnpm run typecheck

# Run tests
pnpm test

# Build for distribution
pnpm run build
```

## Requirements

- Node.js 22+
- pnpm 9+

## License

MIT
