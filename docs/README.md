# Claude CLI OAuth Support

The MCP LLM Bridge supports using Claude CLI's OAuth tokens for authentication, enabling Pro and Max subscription features.

## Overview

Instead of requiring a separate API key, the bridge can read OAuth tokens from the Claude CLI's credential storage and use them for API requests.

## How It Works

1. **Credential Detection**: On startup, the bridge checks for Claude CLI credentials at `~/.claude/.credentials.json`

2. **Token Validation**: Before each request, the bridge verifies the token isn't expiring within 5 minutes

3. **Auto-Refresh**: If a token is expiring soon and a refresh token is available, the bridge attempts to refresh it

4. **Credential Sync**: OAuth tokens are synced to `~/.local/share/opencode/auth.json` for cross-tool compatibility

## Authentication Priority

When making Anthropic API requests, the bridge uses authentication in this order:

1. **OAuth Token** (from Claude CLI) - preferred for Pro/Max features
2. **API Key** (from encrypted Vault) - fallback for legacy setups

## Requirements

- Claude CLI installed and authenticated (`claude auth status`)
- Valid OAuth token in `~/.claude/.credentials.json`
- For Pro/Max features: active Claude Pro or Max subscription

## Configuration

No additional configuration required. The bridge automatically detects and uses OAuth tokens.

### Manual Credential Check

To verify OAuth credentials are available:

```bash
cat ~/.claude/.credentials.json
```

You should see a structure like:

```json
{
  "access_token": "sk-ant-...",
  "refresh_token": "...",
  "expires_at": 1700000000000,
  "token_type": "Bearer"
}
```

## Troubleshooting

### "No Anthropic credentials available"

1. Ensure Claude CLI is installed and authenticated
2. Run `claude auth status` to verify
3. If using API keys, add one via the vault API

### Token Expired

Tokens may expire after extended use. Options:

1. Re-authenticate with Claude CLI: `claude auth login`
2. Use an API key as fallback

### Pro/Max Features Not Working

Ensure your Claude CLI is authenticated with a Pro/Max account:

```bash
claude auth status
```

## Files

| File | Purpose |
|------|---------|
| `~/.claude/.credentials.json` | Claude CLI OAuth credentials (source) |
| `~/.local/share/opencode/auth.json` | Synced credentials for opencode tools |

## Security

- OAuth tokens are read-only (no passwords transmitted)
- Credentials sync only writes to user-owned directories
- Tokens are never logged or exposed in error messages
