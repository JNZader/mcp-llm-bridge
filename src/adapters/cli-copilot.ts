/**
 * Copilot CLI adapter — wraps `copilot -p` command.
 *
 * Copilot has no stdin prompt path (`-p -` is a literal prompt; probed).
 * The prompt body is written to a 0600 temp file and passed as `-p @path`
 * so a 37k RAG payload never appears on argv. Prompts larger than
 * MAX_COPILOT_ARGV_PROMPT_CHARS are still refused.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LLMProvider, GenerateExecutionOptions, GenerateRequest, GenerateResponse } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { throwIfGenerationAborted } from '../core/generation-cancellation.js';
import {
  assertPromptNotOnArgv,
  execCliAsync,
  isCliAvailableAsync,
  MAX_COPILOT_ARGV_PROMPT_CHARS,
} from './cli-utils.js';

export function buildCopilotGenerateArgs(model: string, promptFilePath: string): string[] {
  // `--allow-all-tools` is required for non-interactive `-p` (otherwise Copilot
  // waits on a TTY). Deny shell/write and disable built-in MCPs so generate
  // cannot run host commands or GitHub MCP tools with the injected token.
  return [
    '-p', `@${promptFilePath}`,
    '--model', model,
    '--allow-all-tools',
    '--deny-tool=shell',
    '--deny-tool=write',
    '--disable-builtin-mcps',
  ];
}

export class CopilotCliAdapter implements LLMProvider {
  readonly id = 'copilot-cli';
  readonly name = 'Copilot CLI';
  readonly type = 'cli' as const;
  readonly models = [
    { id: 'gpt-4.1', name: 'GPT-4.1 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1', name: 'GPT-5.1 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.2', name: 'GPT-5.2 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gpt-5.4', name: 'GPT-5.4 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-opus-4.5', name: 'Claude Opus 4.5 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6 (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
    { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 Fast (Copilot)', provider: 'copilot-cli', maxTokens: 8192 },
  ];

  private readonly vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async generate(request: GenerateRequest, executionOptions?: GenerateExecutionOptions): Promise<GenerateResponse> {
    throwIfGenerationAborted(executionOptions);

    const model = request.model ?? 'gpt-4.1';
    const fullPrompt = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
    if (fullPrompt.length > MAX_COPILOT_ARGV_PROMPT_CHARS) {
      throw new Error(
        `Copilot CLI refuses prompts over ${MAX_COPILOT_ARGV_PROMPT_CHARS} characters on argv; use a stdin-capable provider such as opencode-cli`,
      );
    }
    const env: Record<string, string> = {};
    if (process.env.PATH) env.PATH = process.env.PATH;
    if (process.env.LANG) env.LANG = process.env.LANG;
    if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;

    try {
      const token = this.vault.getDecrypted('copilot', 'default', request.project);
      env.COPILOT_GITHUB_TOKEN = token;
      env.GH_TOKEN = token;
      env.GITHUB_TOKEN = token;
    } catch {
      for (const key of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const) {
        const value = process.env[key];
        if (value) env[key] = value;
      }
    }

    throwIfGenerationAborted(executionOptions);
    const promptDir = mkdtempSync(join(tmpdir(), 'mcp-copilot-prompt-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'mcp-copilot-home-'));
    const promptPath = join(promptDir, 'prompt.txt');
    env.HOME = homeDir;
    try {
      writeFileSync(promptPath, fullPrompt, { mode: 0o600 });
      const args = buildCopilotGenerateArgs(model, promptPath);
      assertPromptNotOnArgv('copilot', args, [fullPrompt, request.system, request.prompt]);
      const { stdout } = await execCliAsync('copilot', args, {
        env,
        signal: executionOptions?.signal,
      });
      throwIfGenerationAborted(executionOptions);
      return { text: stdout.trim(), provider: this.id, model, tokensUsed: 0, resolvedProvider: this.id, resolvedModel: model, fallbackUsed: false };
    } finally {
      rmSync(promptDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync('copilot');
  }
}
