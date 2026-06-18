/**
 * Codex CLI adapter — wraps `codex exec` command.
 *
 * Uses OpenAI credentials stored in the Vault.
 * Reads auth.json from the Vault, writing it to a temp
 * directory via HOME override before invocation.
 *
 * The model list is discovered dynamically from ~/.codex/config.toml (the
 * codex CLI does not expose a model catalog), merged with the declared
 * fallback below. See discoverModels() / parseCodexModel().
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { BaseCliAdapter, type CliAdapterConfig } from './base-cli-adapter.js';
import type { ModelInfo } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

/**
 * Declared fallback models. Used as the baseline; the configured model
 * (e.g. gpt-5.5) is discovered dynamically and merged on top — never
 * hardcoded here. See discoverModels().
 */
const CODEX_CONFIG: CliAdapterConfig = {
  id: 'codex-cli',
  name: 'Codex CLI',
  cliCommand: 'codex',
  defaultModel: 'gpt-5.4',
  supportsSystemPrompt: false,
  models: [
    { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'codex-cli', maxTokens: 8192 },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'codex-cli', maxTokens: 8192 },
  ],
};

/**
 * Extract the top-level `model` key from a codex config.toml.
 *
 * Only the top-level table is considered — parsing stops at the first
 * `[section]` header so per-project overrides don't leak in. Pure function,
 * exported for testing.
 */
export function parseCodexModel(toml: string): string | null {
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) break; // entered a section — top-level only
    if (line.startsWith('#') || line.length === 0) continue;
    // Accept both TOML string forms: model = "x" and model = 'x'.
    const match = /^model\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(line);
    if (match) return match[1] ?? match[2] ?? null;
  }
  return null;
}

export class CodexCliAdapter extends BaseCliAdapter {
  readonly config = CODEX_CONFIG;

  constructor(vault: Vault) {
    super(vault);
  }

  protected buildArgs(model: string, prompt: string): string[] {
    return ['exec', '--model', model, JSON.stringify(prompt)];
  }

  protected parseResponse(output: string): string {
    return output.trim();
  }

  /**
   * Discover the configured codex model. Returns null (keep declared
   * fallback) when no config is available or it has no top-level model key.
   */
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    const content = this.readCodexConfig();
    if (!content) return null;
    const model = parseCodexModel(content);
    if (!model) return null;
    return [{ id: model, name: model, provider: this.config.id, maxTokens: 8192 }];
  }

  /**
   * Read config.toml from the SAME source execution will use, so advertised
   * models never diverge from what `codex exec` actually runs (3vr finding A):
   * - if the vault holds provider files, execution runs under a materialized
   *   HOME built only from them — so just a vaulted config.toml is visible;
   * - otherwise execution uses the real HOME — read ~/.codex/config.toml.
   *
   * Global scope (no project): advertised models are provider-level, not
   * per-request.
   */
  private readCodexConfig(): string | null {
    const vaultFiles = this.vault.getProviderFiles(this.config.cliCommand);
    if (vaultFiles.length > 0) {
      return vaultFiles.find((file) => file.fileName === 'config.toml')?.content ?? null;
    }
    try {
      return readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    } catch {
      return null; // no config — degrade to declared fallback
    }
  }
}
