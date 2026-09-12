import { createHash } from 'node:crypto';
import { copyFile, lstat, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types } from 'node:util';
import { dynamicMcpServersEnabled, dynamicPluginLoadTimeoutMs, dynamicPluginToolTimeoutMs, pluginRuntimeConfig } from '../core/mcp-runtime-config.js';
import { ToolCategorySchema } from '../security/profiles.js';
import type { McpServerDefinition, ToolPattern, ToolSecurityMetadata } from './index.js';
import { PluginRuntimeHost, type PluginRuntimeHostOptions } from './plugin-runtime-host.js';
import type { PluginRuntimeRegistry } from './plugin-runtime-registry.js';

export interface LoadedPlugin {
  name: string;
  definition: McpServerDefinition;
}

const PLUGIN_LOAD_ERROR = {
  INVALID_TOP_LEVEL_SHAPE: 'invalid-top-level-shape',
  INVALID_TOOL_SECURITY: 'invalid-tool-security',
  LOAD_FAILED: 'load-failed',
  LOAD_TIMEOUT: 'load-timeout',
} as const;

type PluginLoadErrorCode = (typeof PLUGIN_LOAD_ERROR)[keyof typeof PLUGIN_LOAD_ERROR];

export interface PluginLoadIssue {
  plugin: string;
  file: string;
  code: PluginLoadErrorCode;
  message: string;
  toolName?: string;
}

export interface PluginLoadSummary {
  loaded: LoadedPlugin[];
  skipped: PluginLoadIssue[];
  errors: PluginLoadIssue[];
}

export interface WorkerPluginLoadOptions {
  createRuntime: (plugin: { name: string; file: string }) => Promise<unknown>;
}

/** A worker-admitted plugin has no main-thread closures or resources/prompts. */
export interface WorkerPluginLoadSummary {
  loaded: LoadedPlugin[];
  errors: PluginLoadIssue[];
}

export interface WorkerPluginRuntime {
  start(): Promise<import('./plugin-runtime-protocol.js').PluginRuntimeManifest>;
  invoke(tool: string, args: unknown): Promise<unknown>;
  shutdown(): Promise<void>;
}

export interface WorkerPluginLoaderOptions {
  observeWorkerEntry?: () => Promise<{ entry: URL; hash: string }>;
  observeInstalledPluginDigest?: (root: string) => Promise<string>;
  createRuntime?: (options: PluginRuntimeHostOptions) => WorkerPluginRuntime;
}

let importNonce = 0;


async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutIdentity: symbol): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(timeoutIdentity), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidPluginDefinition(value: unknown): value is McpServerDefinition {
  if (!isRecord(value)) return false;

  return typeof value['name'] === 'string'
    && typeof value['version'] === 'string'
    && typeof value['description'] === 'string'
    && Array.isArray(value['tools'])
    && Array.isArray(value['resources'])
     && Array.isArray(value['prompts']);
}

function isValidToolSecurityMetadata(value: unknown): value is ToolSecurityMetadata {
  if (!isRecord(value)) return false;

  if (!ToolCategorySchema.safeParse(value['category']).success) {
    return false;
  }

  return value['requiresApproval'] === undefined || typeof value['requiresApproval'] === 'boolean';
}

function sanitizePluginDefinition(
  pluginName: string,
  file: string,
  definition: McpServerDefinition,
): { definition: McpServerDefinition; skipped: PluginLoadIssue[] } {
  const skipped: PluginLoadIssue[] = [];
  const tools: ToolPattern[] = [];

  for (const tool of definition.tools) {
    if (!isValidToolSecurityMetadata(tool.security)) {
      skipped.push({
        plugin: pluginName,
        file,
        toolName: tool.name,
        code: PLUGIN_LOAD_ERROR.INVALID_TOOL_SECURITY,
        message: 'Plugin tool security metadata is invalid.',
      });
      continue;
    }

    tools.push(tool);
  }

  return {
    definition: {
      ...definition,
      tools,
    },
    skipped,
  };
}

// This validates an error shape, not filesystem provenance.
function isMissingDirectoryError(error: unknown): boolean {
  if (!types.isNativeError(error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor !== undefined
    && Object.hasOwn(descriptor, 'value')
    && descriptor.value === 'ENOENT';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Digest every regular file below one installed-plugin root. The root is
 * intentionally closed: symlinks and special files make available bytes
 * platform-dependent, so worker admission rejects that layout.
 */
async function installedPluginDigest(root: string): Promise<string> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Plugin runtime requires a real installed-plugin directory.');
  }

  const digest = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Plugin runtime does not support symlinked installed-plugin files.');
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error('Plugin runtime does not support non-regular installed-plugin files.');
      }
      const bytes = await readFile(absolute);
      const canonicalPath = relative(root, absolute).split(sep).join('/');
      digest.update(canonicalPath, 'utf8');
      digest.update('\0');
      digest.update(sha256(bytes), 'utf8');
      digest.update('\0');
    }
  };

  await visit(root);
  return digest.digest('hex');
}

async function workerEntryObservation(): Promise<{ entry: URL; hash: string }> {
  const entry = new URL('./plugin-runtime-worker.js', import.meta.url);
  const path = fileURLToPath(entry);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Plugin runtime worker entry is not a regular installed file.');
  }
  return { entry, hash: sha256(await readFile(path)) };
}

/**
 * Starts each plugin only after an external compatibility manifest has matched
 * the installed worker and complete plugin-root bytes. The registry becomes
 * the sole owner immediately after a successful admission.
 */
export async function loadWorkerPlugins(
  pluginsDir: string,
  registry: PluginRuntimeRegistry,
  options: WorkerPluginLoaderOptions = {},
): Promise<WorkerPluginLoadSummary> {
  if (!dynamicMcpServersEnabled()) return { loaded: [], errors: [] };
  // Preserve the configuration failure boundary before touching a plugin path.
  if (!process.env['MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST']) pluginRuntimeConfig();

  const [worker, digest] = await Promise.all([
    (options.observeWorkerEntry ?? workerEntryObservation)(),
    (options.observeInstalledPluginDigest ?? installedPluginDigest)(pluginsDir),
  ]);
  const runtimeConfig = pluginRuntimeConfig({
    workerEntryHash: worker.hash,
    installedPluginDigest: digest,
  });
  if (runtimeConfig?.mode !== 'worker') {
    throw new Error('Worker plugin loading requires worker runtime mode.');
  }

  const entries = await readdir(pluginsDir);
  const loaded: LoadedPlugin[] = [];
  const errors: PluginLoadIssue[] = [];
  for (const file of entries.filter((entry) => entry.endsWith('.mcp-server.js')).sort()) {
    const pluginUrl = pathToFileURL(resolve(pluginsDir, file)).href;
    const hostOptions: PluginRuntimeHostOptions = {
      workerEntry: worker.entry,
      pluginUrl,
      environment: runtimeConfig.environment,
      importTimeoutMs: dynamicPluginLoadTimeoutMs(),
      invocationTimeoutMs: dynamicPluginToolTimeoutMs(),
    };
    const host = options.createRuntime?.(hostOptions) ?? new PluginRuntimeHost(hostOptions);
    let closePromise: Promise<void> | undefined;
    const closeHost = (): Promise<void> => {
      if (!closePromise) {
        closePromise = Promise.resolve().then(() => host.shutdown());
      }
      return closePromise;
    };
    try {
      const manifest = await host.start();
      await registry.admit({
        filename: file,
        manifest,
        handle: {
          identity: host,
          invoke: (tool, args) => host.invoke(tool, args),
          close: closeHost,
        },
      });
      const definition = registry.definition(manifest.name);
      if (!definition) throw new Error('Admitted plugin runtime definition is unavailable.');
      loaded.push({ name: manifest.name, definition });
    } catch {
      await closeHost().catch(() => undefined);
      errors.push({
        plugin: file.slice(0, -'.mcp-server.js'.length),
        file,
        code: PLUGIN_LOAD_ERROR.LOAD_FAILED,
        message: 'Worker plugin loading failed.',
      });
    }
  }
  return { loaded, errors };
}

export async function loadPlugins(pluginsDir: string, workerOptions?: WorkerPluginLoadOptions): Promise<PluginLoadSummary> {
  if (workerOptions) {
    if (!dynamicMcpServersEnabled()) return { loaded: [], skipped: [], errors: [] };
    // This validation deliberately happens before readdir, a worker constructor, or plugin import.
    pluginRuntimeConfig();
  }
  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch (e) {
    if (isMissingDirectoryError(e)) {
      return { loaded: [], skipped: [], errors: [] };
    }
    throw e;
  }

  const jsFiles = entries.filter((f) => f.endsWith('.mcp-server.js')).sort();
  const importTimeoutMs = dynamicPluginLoadTimeoutMs();

  const loaded: LoadedPlugin[] = [];
  const skipped: PluginLoadIssue[] = [];
  const errors: PluginLoadIssue[] = [];
  for (const file of jsFiles) {
    const pluginName = file.replace('.mcp-server.js', '');
    const sourcePath = resolve(pluginsDir, file);
    const shadowModulePath = resolve(dirname(sourcePath), `.mcp-loader-${importNonce++}-${file}.tmp.mjs`);
    const timeoutIdentity = Symbol();

    try {
      await copyFile(sourcePath, shadowModulePath);
      const module = await withTimeout(
        import(pathToFileURL(shadowModulePath).href),
        importTimeoutMs,
        timeoutIdentity,
      );
      const definition = module.default || module.server || module.definition;
      if (!isValidPluginDefinition(definition)) {
        skipped.push({
          plugin: pluginName,
          file,
          code: PLUGIN_LOAD_ERROR.INVALID_TOP_LEVEL_SHAPE,
          message: 'Plugin definition is invalid.',
        });
        continue;
      }

      const sanitized = sanitizePluginDefinition(pluginName, file, definition);
      skipped.push(...sanitized.skipped);
      loaded.push({ name: pluginName, definition: sanitized.definition });
    } catch (e) {
      if (e === timeoutIdentity) {
        errors.push({
          plugin: pluginName,
          file,
          code: PLUGIN_LOAD_ERROR.LOAD_TIMEOUT,
          message: 'Plugin loading timed out.',
        });
        continue;
      }

      errors.push({
        plugin: pluginName,
        file,
        code: PLUGIN_LOAD_ERROR.LOAD_FAILED,
        message: 'Plugin loading failed.',
      });
    } finally {
      await rm(shadowModulePath, { force: true });
    }
  }
  return { loaded, skipped, errors };
}
