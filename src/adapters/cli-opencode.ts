/**
 * OpenCode CLI adapter — wraps `opencode run` command.
 *
 * Uses subscription-based routing through OpenCode's servers.
 * Reads credentials from auth.json stored in the Vault, writing
 * it to a temp directory via XDG_DATA_HOME before invocation.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LLMProvider, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { execCliSync, isCliAvailableAsync } from './cli-utils.js';

/**
 * Parse OpenCode's newline-delimited JSON output into text + token usage.
 */
function parseOpenCodeOutput(raw: string): { text: string; tokens?: { input?: number; output?: number } } {
  const lines = raw.split('\n').filter(line => line.trim().length > 0);
  const textParts: string[] = [];
  let tokens: { input?: number; output?: number } | undefined;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event['type'] === 'text') {
        const part = event['part'] as Record<string, unknown> | undefined;
        if (part?.['text']) {
          textParts.push(part['text'] as string);
        }
      } else if (event['type'] === 'step_finish') {
        const part = event['part'] as Record<string, unknown> | undefined;
        if (part?.['tokens']) {
          tokens = part['tokens'] as { input?: number; output?: number };
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return { text: textParts.join(''), tokens };
}

export class CliOpenCodeAdapter implements LLMProvider {
  readonly id = 'opencode-cli';
  readonly name = 'OpenCode CLI';
  readonly type = 'cli' as const;
  readonly models = [
    // Free tier (opencode/*)
    { id: 'opencode/big-pickle', name: 'Big Pickle', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/gpt-5-nano', name: 'GPT-5 Nano', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/mimo-v2-omni-free', name: 'MIMO v2 Omni Free', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/mimo-v2-pro-free', name: 'MIMO v2 Pro Free', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/minimax-m2.5-free', name: 'MiniMax M2.5 Free', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode/nemotron-3-super-free', name: 'Nemotron 3 Super Free', provider: 'opencode-cli', maxTokens: 8192 },
    // OpenCode Go (subscription)
    { id: 'opencode-go/glm-5', name: 'GLM-5', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode-go/kimi-k2.5', name: 'Kimi K2.5', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode-go/minimax-m2.5', name: 'MiniMax M2.5', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'opencode-go/minimax-m2.7', name: 'MiniMax M2.7', provider: 'opencode-cli', maxTokens: 8192 },
    // Anthropic via OpenCode
    { id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku Latest', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet (Jun)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Oct)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet Latest', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (Oct)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-0', name: 'Claude Opus 4.0', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-1', name: 'Claude Opus 4.1', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-1-20250805', name: 'Claude Opus 4.1 (Aug)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-20250514', name: 'Claude Opus 4 (May)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-5-20251101', name: 'Claude Opus 4.5 (Nov)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-sonnet-4-0', name: 'Claude Sonnet 4.0', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (May)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Sep)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'opencode-cli', maxTokens: 8192 },
    // GitHub Copilot via OpenCode
    { id: 'github-copilot/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-opus-4.5', name: 'Claude Opus 4.5 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-opus-4.6', name: 'Claude Opus 4.6 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-opus-41', name: 'Claude Opus 4.1 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-sonnet-4', name: 'Claude Sonnet 4 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gemini-2.5-pro', name: 'Gemini 2.5 Pro (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gemini-3-flash-preview', name: 'Gemini 3 Flash (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gemini-3-pro-preview', name: 'Gemini 3 Pro (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-4.1', name: 'GPT-4.1 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-4o', name: 'GPT-4o (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5', name: 'GPT-5 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5-mini', name: 'GPT-5 Mini (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.1', name: 'GPT-5.1 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.1-codex', name: 'GPT-5.1 Codex (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.2', name: 'GPT-5.2 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.2-codex', name: 'GPT-5.2 Codex (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.3-codex', name: 'GPT-5.3 Codex (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.4', name: 'GPT-5.4 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/gpt-5.4-mini', name: 'GPT-5.4 Mini (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'github-copilot/grok-code-fast-1', name: 'Grok Code Fast 1 (Copilot)', provider: 'opencode-cli', maxTokens: 8192 },
    // OpenAI via OpenCode
    { id: 'openai/codex-mini-latest', name: 'Codex Mini Latest', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5-codex', name: 'GPT-5 Codex', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.2', name: 'GPT-5.2', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', provider: 'opencode-cli', maxTokens: 8192 },
    { id: 'openai/gpt-5.4', name: 'GPT-5.4', provider: 'opencode-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? 'opencode/gpt-5-nano';
    const authContent = this.vault.getFile('opencode', 'auth.json', request.project);

    // Build temp dir for auth.json if available
    const tempBase = `/tmp/opencode-auth-${process.pid}-${Date.now()}`;
    const authDir = join(tempBase, 'opencode');

    try {
      // Set up auth.json via XDG_DATA_HOME if available
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (authContent) {
        mkdirSync(authDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(authDir, 'auth.json'), authContent, { mode: 0o600 });
        env['XDG_DATA_HOME'] = tempBase;
      }

      const args = ['run', '--model', model, '--format', 'json'];

      // Combine system + user prompt (OpenCode CLI has no --system flag)
      const fullPrompt = request.system
        ? `${request.system}\n\n---\n\n${request.prompt}`
        : request.prompt;

      // Use execFileSync instead of execSync with string interpolation
      const output = execCliSync('opencode', args, {
        input: fullPrompt,
        env,
      });

      const parsed = parseOpenCodeOutput(output);
      const totalTokens = parsed.tokens
        ? (parsed.tokens.input ?? 0) + (parsed.tokens.output ?? 0)
        : 0;

      return {
        text: parsed.text || output.trim(),
        provider: this.id,
        model,
        tokensUsed: totalTokens,
      };
    } catch (error) {
      // If it's an exec error with stdout, try to parse partial output
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        const parsed = parseOpenCodeOutput(execError.stdout);
        if (parsed.text) {
          return {
            text: parsed.text,
            provider: this.id,
            model,
            tokensUsed: 0,
          };
        }
      }
      throw new Error(
        `OpenCode CLI failed: ${execError.message ?? String(error)}`,
      );
    } finally {
      // Clean up temp files
      if (existsSync(tempBase)) {
        rmSync(tempBase, { recursive: true, force: true });
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync('opencode');
  }
}
