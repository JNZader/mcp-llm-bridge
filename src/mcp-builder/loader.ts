import { copyFile, readdir, rm } from 'fs/promises';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { McpServerDefinition } from './index.js';

export interface LoadedPlugin {
  name: string;
  definition: McpServerDefinition;
}

const PLUGIN_LOAD_ERROR = {
  INVALID_TOP_LEVEL_SHAPE: 'invalid-top-level-shape',
  LOAD_FAILED: 'load-failed',
} as const;

type PluginLoadErrorCode = (typeof PLUGIN_LOAD_ERROR)[keyof typeof PLUGIN_LOAD_ERROR];

export interface PluginLoadIssue {
  plugin: string;
  file: string;
  code: PluginLoadErrorCode;
  message: string;
}

export interface PluginLoadSummary {
  loaded: LoadedPlugin[];
  skipped: PluginLoadIssue[];
  errors: PluginLoadIssue[];
}

let importNonce = 0;

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

export async function loadPlugins(pluginsDir: string): Promise<PluginLoadSummary> {
  try {
    const entries = await readdir(pluginsDir);
    const jsFiles = entries.filter((f) => f.endsWith('.mcp-server.js')).sort();

    const loaded: LoadedPlugin[] = [];
    const skipped: PluginLoadIssue[] = [];
    const errors: PluginLoadIssue[] = [];
    for (const file of jsFiles) {
      const pluginName = file.replace('.mcp-server.js', '');
      const sourcePath = resolve(pluginsDir, file);
      const shadowModulePath = resolve(dirname(sourcePath), `.mcp-loader-${importNonce++}-${file}.tmp.mjs`);

      try {
        await copyFile(sourcePath, shadowModulePath);
        const module = await import(pathToFileURL(shadowModulePath).href);
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
        loaded.push({ name: pluginName, definition });
      } catch (e) {
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
