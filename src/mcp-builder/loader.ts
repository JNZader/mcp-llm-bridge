import { copyFile, readdir, rm } from 'fs/promises';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import { dynamicPluginLoadTimeoutMs } from '../core/mcp-runtime-config.js';
import { ToolCategorySchema } from '../security/profiles.js';
import type { McpServerDefinition, ToolPattern, ToolSecurityMetadata } from './index.js';

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

let importNonce = 0;

class PluginImportTimeoutError extends Error {
  readonly code = PLUGIN_LOAD_ERROR.LOAD_TIMEOUT;

  constructor(
    readonly plugin: string,
    readonly file: string,
    readonly timeoutMs: number,
  ) {
    super(`Plugin import timed out after ${timeoutMs}ms`);
    this.name = 'PluginImportTimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(onTimeout()), timeoutMs);
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
        message: `Tool "${tool.name}" must declare valid security metadata with category and optional requiresApproval`,
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

export async function loadPlugins(pluginsDir: string): Promise<PluginLoadSummary> {
  try {
    const entries = await readdir(pluginsDir);
    const jsFiles = entries.filter((f) => f.endsWith('.mcp-server.js')).sort();
    const importTimeoutMs = dynamicPluginLoadTimeoutMs();

    const loaded: LoadedPlugin[] = [];
    const skipped: PluginLoadIssue[] = [];
    const errors: PluginLoadIssue[] = [];
    for (const file of jsFiles) {
      const pluginName = file.replace('.mcp-server.js', '');
      const sourcePath = resolve(pluginsDir, file);
      const shadowModulePath = resolve(dirname(sourcePath), `.mcp-loader-${importNonce++}-${file}.tmp.mjs`);

      try {
        await copyFile(sourcePath, shadowModulePath);
        const module = await withTimeout(
          import(pathToFileURL(shadowModulePath).href),
          importTimeoutMs,
          () => new PluginImportTimeoutError(pluginName, file, importTimeoutMs),
        );
        const definition = module.default || module.server || module.definition;
        if (!isValidPluginDefinition(definition)) {
          skipped.push({
            plugin: pluginName,
            file,
            code: PLUGIN_LOAD_ERROR.INVALID_TOP_LEVEL_SHAPE,
            message: 'Plugin export must include string name/version/description and array tools/resources/prompts',
          });
          continue;
        }

        const sanitized = sanitizePluginDefinition(pluginName, file, definition);
        skipped.push(...sanitized.skipped);
        loaded.push({ name: pluginName, definition: sanitized.definition });
      } catch (e) {
        if (e instanceof PluginImportTimeoutError) {
          errors.push({
            plugin: e.plugin,
            file: e.file,
            code: e.code,
            message: e.message,
          });
          continue;
        }

        const message = e instanceof Error ? e.message : String(e);
        errors.push({
          plugin: pluginName,
          file,
          code: PLUGIN_LOAD_ERROR.LOAD_FAILED,
          message,
        });
      } finally {
        await rm(shadowModulePath, { force: true });
      }
    }
    return { loaded, skipped, errors };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { loaded: [], skipped: [], errors: [] };
    }
    throw e;
  }
}
