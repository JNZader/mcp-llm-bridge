/**
 * Runtime config readers for dynamic MCP server loading.
 *
 * These helpers intentionally read process.env at call time so tests and
 * runtime code can observe env mutations after module import.
 */

export const DEFAULT_MCP_SERVERS_DIR = './mcp-servers';
export const DEFAULT_MCP_PLUGIN_LOAD_TIMEOUT_MS = 5_000;
export const DEFAULT_MCP_PLUGIN_TOOL_TIMEOUT_MS = 10_000;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const COMPATIBILITY_KEYS = [
  'nodeMajor',
  'platform',
  'arch',
  'workerEntryHash',
  'installedPluginDigest',
] as const;

export type PluginRuntimeMode = 'legacy' | 'worker';
export type PluginRuntimeConfigErrorCode = 'CONFIG_INVALID' | 'COMPATIBILITY_UNESTABLISHED';

export class PluginRuntimeConfigError extends Error {
  constructor(public readonly code: PluginRuntimeConfigErrorCode, message: string) {
    super(message);
    this.name = 'PluginRuntimeConfigError';
  }
}

export interface PluginWorkerCompatibilityManifest {
  nodeMajor: number;
  platform: string;
  arch: string;
  workerEntryHash: string;
  installedPluginDigest: string;
}

export interface PluginRuntimeCompatibilityObserved {
  workerEntryHash?: string;
  installedPluginDigest?: string;
}

export interface PluginRuntimeConfig {
  mode: PluginRuntimeMode;
  environment: Record<string, string>;
  compatibilityManifest?: PluginWorkerCompatibilityManifest;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function configInvalid(message: string): never {
  throw new PluginRuntimeConfigError('CONFIG_INVALID', message);
}

function compatibilityUnestablished(): never {
  throw new PluginRuntimeConfigError(
    'COMPATIBILITY_UNESTABLISHED',
    'Plugin worker compatibility evidence is unavailable or does not match this runtime.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function parseAllowlistedEnvironment(): Record<string, string> {
  const raw = process.env['MCP_PLUGIN_WORKER_ENV_ALLOWLIST'];
  if (!raw) return {};

  const names = raw.split(',').map((name) => name.trim());
  const seen = new Set<string>();
  const environment: Record<string, string> = {};

  for (const name of names) {
    if (!ENVIRONMENT_NAME.test(name) || name === 'NODE_OPTIONS' || name === 'NODE_PATH' || seen.has(name)) {
      configInvalid('Plugin worker environment allowlist is invalid.');
    }
    seen.add(name);

    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }

  return environment;
}

function parseCompatibilityManifest(): PluginWorkerCompatibilityManifest {
  const raw = process.env['MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST'];
  if (!raw) compatibilityUnestablished();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    compatibilityUnestablished();
  }

  if (!isRecord(parsed) || !hasExactKeys(parsed, COMPATIBILITY_KEYS)) compatibilityUnestablished();

  const manifest = parsed as unknown as PluginWorkerCompatibilityManifest;
  if (!Number.isInteger(manifest.nodeMajor) || manifest.nodeMajor <= 0
    || typeof manifest.platform !== 'string' || manifest.platform.length === 0
    || typeof manifest.arch !== 'string' || manifest.arch.length === 0
    || !SHA256_HEX.test(manifest.workerEntryHash)
    || !SHA256_HEX.test(manifest.installedPluginDigest)) {
    compatibilityUnestablished();
  }

  return manifest;
}

function compatibilityMatches(
  manifest: PluginWorkerCompatibilityManifest,
  observed: PluginRuntimeCompatibilityObserved,
): boolean {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  return manifest.nodeMajor === nodeMajor
    && manifest.platform === process.platform
    && manifest.arch === process.arch
    && observed.workerEntryHash !== undefined
    && observed.installedPluginDigest !== undefined
    && manifest.workerEntryHash === observed.workerEntryHash
    && manifest.installedPluginDigest === observed.installedPluginDigest;
}

export function dynamicMcpServersEnabled(): boolean {
  return process.env['MCP_DYNAMIC_SERVERS'] === 'true';
}

export function pluginRuntimeConfig(
  observed: PluginRuntimeCompatibilityObserved = {},
): PluginRuntimeConfig | undefined {
  if (!dynamicMcpServersEnabled()) return undefined;

  const rawMode = process.env['MCP_PLUGIN_RUNTIME_MODE'];
  const mode: PluginRuntimeMode = rawMode === undefined || rawMode === '' ? 'legacy' : rawMode as PluginRuntimeMode;
  if (mode !== 'legacy' && mode !== 'worker') configInvalid('Plugin runtime mode is invalid.');

  const environment = parseAllowlistedEnvironment();
  if (mode === 'legacy') return { mode, environment };

  const compatibilityManifest = parseCompatibilityManifest();
  if (!compatibilityMatches(compatibilityManifest, observed)) compatibilityUnestablished();

  return { mode, environment, compatibilityManifest };
}

export function mcpServersDir(): string {
  return process.env['MCP_SERVERS_DIR'] || DEFAULT_MCP_SERVERS_DIR;
}

export function dynamicPluginLoadTimeoutMs(): number {
  return readPositiveIntEnv('MCP_PLUGIN_LOAD_TIMEOUT_MS', DEFAULT_MCP_PLUGIN_LOAD_TIMEOUT_MS);
}

export function dynamicPluginToolTimeoutMs(): number {
  return readPositiveIntEnv('MCP_PLUGIN_TOOL_TIMEOUT_MS', DEFAULT_MCP_PLUGIN_TOOL_TIMEOUT_MS);
}
