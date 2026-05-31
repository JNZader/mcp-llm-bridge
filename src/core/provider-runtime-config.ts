export function resolveProviderApiKeyEnv(providerName: string): string {
  return `${providerName.toUpperCase()}_API_KEY`;
}

export function resolveProviderBaseUrlEnv(providerName: string): string {
  return `${providerName.toUpperCase()}_BASE_URL`;
}

export function readRuntimeEnv(envName: string | undefined): string | undefined {
  return envName ? process.env[envName] : undefined;
}

export function resolveProviderApiKey(providerName: string): string | undefined {
  return readRuntimeEnv(resolveProviderApiKeyEnv(providerName));
}

export function resolveProviderBaseUrl(providerName: string): string | undefined {
  return readRuntimeEnv(resolveProviderBaseUrlEnv(providerName));
}
