export const PROVIDER_ALIASES = {
  opencode: 'opencode-cli',
  codex: 'codex-cli',
  gemini: 'gemini-cli',
  qwen: 'qwen-cli',
  copilot: 'copilot-cli',
  glm: 'zai',
} as const;

export function normalizeProviderId(provider: string | undefined): string | undefined {
  if (provider === undefined) {
    return undefined;
  }

  if (provider in PROVIDER_ALIASES) {
    return PROVIDER_ALIASES[provider as keyof typeof PROVIDER_ALIASES];
  }

  return provider;
}
