import { execSync } from 'node:child_process';
import type { CliProvider } from './detect.js';

export interface GenerateOptions {
  prompt: string;
  system?: string;
  preferredProvider?: string;
}

export interface GenerateResult {
  text: string;
  provider: string;
  tokensUsed: number;
}

type CliAdapter = (prompt: string, system: string | undefined) => GenerateResult;

// Adapter for each CLI
const adapters: Record<string, CliAdapter> = {
  claude: (prompt: string, system: string | undefined): GenerateResult => {
    const args = ['-p', JSON.stringify(prompt), '--output-format', 'json', '--max-turns', '1'];
    if (system) args.push('--system-prompt', JSON.stringify(system));

    const output = execSync(`claude ${args.join(' ')}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      const parsed: Record<string, unknown> = JSON.parse(output);
      const content = parsed['content'];
      const firstContent = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined) : undefined;
      const text = (parsed['result'] as string | undefined)
        ?? (firstContent?.['text'] as string | undefined)
        ?? output;
      const usage = parsed['usage'] as Record<string, unknown> | undefined;
      return { text, provider: 'claude', tokensUsed: (usage?.['total_tokens'] as number) ?? 0 };
    } catch {
      return { text: output.trim(), provider: 'claude', tokensUsed: 0 };
    }
  },

  gemini: (prompt: string, system: string | undefined): GenerateResult => {
    // Gemini doesn't support --system-prompt, prepend to prompt
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
    const args = ['-p', JSON.stringify(fullPrompt), '--output-format', 'json'];

    const output = execSync(`gemini ${args.join(' ')}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      const parsed: Record<string, unknown> = JSON.parse(output);
      return { text: (parsed['response'] as string | undefined) ?? output, provider: 'gemini', tokensUsed: 0 };
    } catch {
      return { text: output.trim(), provider: 'gemini', tokensUsed: 0 };
    }
  },

  codex: (prompt: string, system: string | undefined): GenerateResult => {
    // Codex doesn't support system prompt via flag
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;

    const output = execSync(`codex exec ${JSON.stringify(fullPrompt)}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { text: output.trim(), provider: 'codex', tokensUsed: 0 };
  },

  copilot: (prompt: string, _system: string | undefined): GenerateResult => {
    // Copilot doesn't support system prompt or JSON output
    const output = execSync(`copilot -p ${JSON.stringify(prompt)} --allow-all-tools`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { text: output.trim(), provider: 'copilot', tokensUsed: 0 };
  },
};

export async function generate(
  providers: CliProvider[],
  { prompt, system, preferredProvider }: GenerateOptions,
): Promise<GenerateResult> {
  // Pick provider: preferred if specified and available, otherwise first available
  const orderedProviders = preferredProvider
    ? [
        ...providers.filter(p => p.name === preferredProvider),
        ...providers.filter(p => p.name !== preferredProvider),
      ]
    : providers;

  // Try each provider in order (fallback on failure)
  for (const provider of orderedProviders) {
    const adapter = adapters[provider.name];
    if (!adapter) continue;

    try {
      console.error(`[mcp-llm-bridge] Generating with ${provider.name}...`);
      const result = adapter(prompt, system);
      console.error(`[mcp-llm-bridge] \u2713 ${provider.name} responded (${result.text.length} chars)`);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mcp-llm-bridge] \u2717 ${provider.name} failed: ${message}`);
      continue;
    }
  }

  throw new Error('All providers failed. Ensure at least one CLI (claude, gemini, codex, copilot) is installed and authenticated.');
}
