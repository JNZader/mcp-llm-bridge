import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { McpServerDefinition } from './index.js';

export interface LoadedPlugin {
  name: string;
  definition: McpServerDefinition;
}

export async function loadPlugins(pluginsDir: string): Promise<LoadedPlugin[]> {
  try {
    const entries = await readdir(pluginsDir);
    const jsFiles = entries.filter((f) => f.endsWith('.mcp-server.js'));

    const plugins: LoadedPlugin[] = [];
    for (const file of jsFiles) {
      try {
        const modulePath = pathToFileURL(resolve(pluginsDir, file)).href;
        const module = await import(modulePath);
        const definition = module.default || module.server || module.definition;
        if (!definition || !definition.tools) {
          console.warn(`[PluginLoader] ${file}: invalid export shape`);
          continue;
        }
        plugins.push({ name: file.replace('.mcp-server.js', ''), definition });
      } catch (e) {
        console.warn(`[PluginLoader] ${file}: load failed — ${e}`);
      }
    }
    return plugins;
  } catch (e) {
    if ((e as any).code === 'ENOENT') {
      console.warn(`[PluginLoader] Directory not found: ${pluginsDir}`);
      return [];
    }
    throw e;
  }
}
