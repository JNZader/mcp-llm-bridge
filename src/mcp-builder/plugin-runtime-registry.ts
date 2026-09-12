import { TOOLS } from '../server/mcp-tool-registry.js';
import { TOOL_SECURITY_CATEGORY, type McpServerDefinition, type ToolHandler, type ToolPattern } from './index.js';

const SECURITY_CATEGORY = new Set<string>(Object.values(TOOL_SECURITY_CATEGORY));

export interface PluginRuntimeToolSecurity {
  category: string;
  requiresApproval?: boolean;
}

export interface PluginRuntimeToolManifest {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  security?: PluginRuntimeToolSecurity;
}

export interface PluginRuntimeManifest {
  v: 1;
  name: string;
  version: string;
  description: string;
  tools: PluginRuntimeToolManifest[];
}

export interface PluginRuntimeHandle {
  readonly identity: object;
  invoke(tool: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface PluginRuntimeCandidate {
  filename: string;
  manifest: PluginRuntimeManifest;
  handle: PluginRuntimeHandle;
}

interface RegisteredRuntime {
  handle: PluginRuntimeHandle;
  manifest: PluginRuntimeManifest;
}

function filenameIdentity(filename: string): string {
  return filename.endsWith('.mcp-server.js') ? filename.slice(0, -'.mcp-server.js'.length) : '';
}

function requireManifest(candidate: PluginRuntimeCandidate, ownedTools: Set<string>, builtIns: Set<string>): void {
  if (filenameIdentity(candidate.filename) !== candidate.manifest.name) {
    throw new Error('Plugin manifest identity does not match its filename.');
  }

  const local = new Set<string>();
  for (const tool of candidate.manifest.tools) {
    if (!tool.security || !SECURITY_CATEGORY.has(tool.security.category)
      || (tool.security.requiresApproval !== undefined && typeof tool.security.requiresApproval !== 'boolean')) {
      throw new Error('Plugin tool security metadata is invalid.');
    }
    if (builtIns.has(tool.name)) throw new Error(`Tool collision with built-in tool: ${tool.name}`);
    if (local.has(tool.name) || ownedTools.has(tool.name)) throw new Error(`Plugin tool collision: ${tool.name}`);
    local.add(tool.name);
  }
}

export class PluginRuntimeRegistry {
  private readonly runtimes = new Map<string, RegisteredRuntime>();
  private readonly toolOwners = new Map<string, string>();
  private readonly transferred = new WeakSet<object>();
  private closePromise?: Promise<void>;
  private closed = false;

  constructor(private readonly builtIns: ReadonlySet<string> = new Set(TOOLS.map((tool) => tool.name))) {}

  async admit(candidate: PluginRuntimeCandidate): Promise<void> {
    if (this.closed) {
      await candidate.handle.close();
      throw new Error('Plugin runtime registry is closed.');
    }
    if (this.transferred.has(candidate.handle.identity)) {
      throw new Error('Plugin runtime handle was already transferred.');
    }

    try {
      requireManifest(candidate, new Set(this.toolOwners.keys()), new Set(this.builtIns));
      if (this.runtimes.has(candidate.manifest.name)) throw new Error('Plugin runtime was already admitted.');
      this.transferred.add(candidate.handle.identity);
      this.runtimes.set(candidate.manifest.name, { handle: candidate.handle, manifest: candidate.manifest });
      for (const tool of candidate.manifest.tools) this.toolOwners.set(tool.name, candidate.manifest.name);
    } catch (error) {
      await candidate.handle.close();
      throw error;
    }
  }

  async invoke(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const pluginName = this.toolOwners.get(tool);
    if (!pluginName) throw new Error('Plugin tool is unavailable before admission.');
    const runtime = this.runtimes.get(pluginName);
    if (!runtime) throw new Error('Plugin runtime is unavailable.');
    return runtime.handle.invoke(tool, args);
  }

  definition(name: string): McpServerDefinition | undefined {
    const runtime = this.runtimes.get(name);
    if (!runtime) return undefined;
    const tools: ToolPattern[] = runtime.manifest.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      security: tool.security as ToolPattern['security'],
      handler: ((args: Record<string, unknown>) => this.invoke(tool.name, args)) as ToolHandler,
    }));
    return { name: runtime.manifest.name, version: runtime.manifest.version, description: runtime.manifest.description, tools, resources: [], prompts: [] };
  }

  async closeAll(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      const runtimes = Array.from(this.runtimes.values());
      this.runtimes.clear();
      this.toolOwners.clear();
      await Promise.all(runtimes.map(async (runtime) => runtime.handle.close()));
    })();
    return this.closePromise;
  }
}

export function createPluginRuntimeRegistry(): PluginRuntimeRegistry {
  return new PluginRuntimeRegistry();
}
