import { execSync } from 'node:child_process';

// Adapter for each CLI
const adapters = {
  claude: (prompt, system) => {
    const args = ['-p', JSON.stringify(prompt), '--output-format', 'json', '--max-turns', '1'];
    if (system) args.push('--system-prompt', JSON.stringify(system));

    const output = execSync(`claude ${args.join(' ')}`, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      const parsed = JSON.parse(output);
      // Claude JSON output has result field with text
      const text = parsed.result || parsed.content?.[0]?.text || output;
      return { text, provider: 'claude', tokensUsed: parsed.usage?.total_tokens ?? 0 };
    } catch {
      return { text: output.trim(), provider: 'claude', tokensUsed: 0 };
    }
  },

  gemini: (prompt, system) => {
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
      const parsed = JSON.parse(output);
      return { text: parsed.response || output, provider: 'gemini', tokensUsed: 0 };
    } catch {
      return { text: output.trim(), provider: 'gemini', tokensUsed: 0 };
    }
  },

  codex: (prompt, system) => {
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

  copilot: (prompt, _system) => {
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

export async function generate(providers, { prompt, system, preferredProvider }) {
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
      console.error(`[mcp-llm-bridge] ✓ ${provider.name} responded (${result.text.length} chars)`);
      return result;
    } catch (error) {
      console.error(`[mcp-llm-bridge] ✗ ${provider.name} failed: ${error.message}`);
      continue;
    }
  }

  throw new Error('All providers failed. Ensure at least one CLI (claude, gemini, codex, copilot) is installed and authenticated.');
}
