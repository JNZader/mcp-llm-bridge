import { execSync } from 'node:child_process';

export interface CliProvider {
  name: string;
  command: string;
  check: string;
  priority: number;
}

const CLI_CHECKS: readonly CliProvider[] = [
  { name: 'claude', command: 'claude', check: 'claude --version', priority: 1 },
  { name: 'gemini', command: 'gemini', check: 'gemini --version', priority: 2 },
  { name: 'codex', command: 'codex', check: 'codex --version', priority: 3 },
  { name: 'copilot', command: 'copilot', check: 'copilot --version', priority: 4 },
] as const;

export async function detectProviders(): Promise<CliProvider[]> {
  const available: CliProvider[] = [];

  for (const cli of CLI_CHECKS) {
    try {
      execSync(cli.check, { timeout: 5000, stdio: 'pipe' });
      available.push(cli);
      console.error(`[mcp-llm-bridge] \u2713 ${cli.name} detected`);
    } catch {
      console.error(`[mcp-llm-bridge] \u2717 ${cli.name} not found`);
    }
  }

  return available.sort((a, b) => a.priority - b.priority);
}
