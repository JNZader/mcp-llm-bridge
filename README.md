# mcp-llm-bridge

An MCP server that routes LLM calls through CLI tools you already have installed — Claude Code, Gemini CLI, Codex CLI, or Copilot CLI. Any app that speaks MCP can use it to generate text without API tokens, using your existing subscriptions.

## Install

```bash
npm install -g mcp-llm-bridge
```

## Configure

### Claude Desktop

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

### Claude Code

Add to `.mcp.json` in your project or `~/.config/claude/mcp.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

## Usage

Once configured, the `llm_generate` tool is available to any MCP client:

```
llm_generate({ prompt: "Explain quicksort in one paragraph" })
```

With a system prompt:

```
llm_generate({
  prompt: "Review this function for bugs",
  system: "You are a senior code reviewer. Be concise."
})
```

Request a specific provider:

```
llm_generate({
  prompt: "Write a haiku about Rust",
  provider: "gemini"
})
```

## Supported CLIs

| Provider | CLI Command | System Prompt | JSON Output | Priority |
|----------|-------------|:-------------:|:-----------:|:--------:|
| Claude Code | `claude` | ✓ | ✓ | 1 |
| Gemini CLI | `gemini` | prepended | ✓ | 2 |
| Codex CLI | `codex` | prepended | ✗ | 3 |
| Copilot CLI | `copilot` | ✗ | ✗ | 4 |

## How it works

1. **Auto-detect**: On startup, the server checks which CLIs are installed by running `<cli> --version`.
2. **Priority order**: When no provider is specified, the first available CLI (by priority) is used.
3. **Fallback chain**: If a provider fails, the next one in the list is tried automatically.
4. **Stdio transport**: Communicates with MCP clients over stdin/stdout (standard MCP protocol).

## Requirements

- Node.js 18+
- At least one supported CLI installed and authenticated

## License

MIT
