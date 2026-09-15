import { parentPort, workerData } from 'node:worker_threads';
import {
  PLUGIN_RUNTIME_ERROR,
  PluginRuntimeProtocolError,
  validatePluginRuntimeEnvelope,
  validatePluginRuntimeManifest,
  type PluginRuntimeManifest,
  type PluginRuntimeSecurity,
  type PluginRuntimeToolManifest,
} from './plugin-runtime-protocol.js';
import type { McpServerDefinition, ToolPattern } from './index.js';

export interface PluginRuntimeModule {
  manifest: PluginRuntimeManifest;
  tools: Record<string, (args: unknown) => unknown | Promise<unknown>>;
}

export interface PluginRuntimePort {
  postMessage(value: unknown): void;
  on(event: 'message', listener: (value: unknown) => void): void;
  close?(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function correlatedId(value: unknown): string | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const id = readDataProperty(value, 'id');
    if (typeof id !== 'string') return undefined;
    validatePluginRuntimeEnvelope({ v: 1, kind: 'result', id, result: null });
    return id;
  } catch {
    return undefined;
  }
}

function postFailure(port: PluginRuntimePort, code: keyof typeof PLUGIN_RUNTIME_ERROR, id?: string): void {
  port.postMessage(id === undefined
    ? { v: 1, kind: 'failure', code }
    : { v: 1, kind: 'failure', id, code });
}

function asSecurity(value: unknown): PluginRuntimeSecurity | undefined {
  if (!isRecord(value) || typeof value['category'] !== 'string') return undefined;
  const category = value['category'];
  if (!['read', 'generate', 'destructive', 'admin'].includes(category)) return undefined;
  const requiresApproval = value['requiresApproval'];
  if (requiresApproval !== undefined && typeof requiresApproval !== 'boolean') return undefined;
  if (Object.keys(value).some((key) => key !== 'category' && key !== 'requiresApproval')) return undefined;
  return requiresApproval === undefined
    ? { category: category as PluginRuntimeSecurity['category'] }
    : { category: category as PluginRuntimeSecurity['category'], requiresApproval };
}

function asTool(value: unknown): ToolPattern | undefined {
  if (!isRecord(value)
    || typeof value['name'] !== 'string'
    || typeof value['description'] !== 'string'
    || !isRecord(value['inputSchema'])
    || typeof value['handler'] !== 'function') return undefined;
  const security = asSecurity(value['security']);
  if (!security) return undefined;
  return {
    name: value['name'],
    description: value['description'],
    inputSchema: value['inputSchema'],
    handler: value['handler'] as ToolPattern['handler'],
    security,
  };
}

/** Imports one MCP definition and projects only its retained tool closures onto the worker wire. */
export async function importMcpServerDefinition(pluginUrl: string): Promise<PluginRuntimeModule> {
  const imported = await import(pluginUrl) as Record<string, unknown>;
  const definition = imported['default'] ?? imported['server'] ?? imported['definition'];
  if (!isRecord(definition)
    || typeof definition['name'] !== 'string'
    || typeof definition['version'] !== 'string'
    || typeof definition['description'] !== 'string'
    || !Array.isArray(definition['tools'])
    || !Array.isArray(definition['resources'])
    || !Array.isArray(definition['prompts'])) {
    throw new PluginRuntimeProtocolError('PROTOCOL_INVALID', 'Plugin must export an MCP server definition.');
  }

  const typedDefinition = definition as unknown as McpServerDefinition;
  const tools: Record<string, (args: unknown) => unknown | Promise<unknown>> = {};
  const manifestTools: PluginRuntimeToolManifest[] = [];
  for (const value of typedDefinition.tools) {
    const tool = asTool(value);
    if (!tool || Object.hasOwn(tools, tool.name)) {
      throw new PluginRuntimeProtocolError('PROTOCOL_INVALID', 'Plugin tool definition is invalid.');
    }
    const security = tool.security!;
    tools[tool.name] = (args) => tool.handler(args as Record<string, unknown>);
    manifestTools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      security: security.requiresApproval === undefined
        ? { category: security.category }
        : { category: security.category, requiresApproval: security.requiresApproval },
    });
  }

  const manifest = validatePluginRuntimeManifest({
    v: 1,
    name: typedDefinition.name,
    version: typedDefinition.version,
    description: typedDefinition.description,
    tools: manifestTools,
  });
  return { manifest, tools };
}

export function createPluginRuntimeDispatcher(runtime: PluginRuntimeModule, port: PluginRuntimePort): void {
  const manifest = validatePluginRuntimeManifest(runtime.manifest);
  port.postMessage({ v: 1, kind: 'ready', manifest });
  port.on('message', async (value) => {
    const id = correlatedId(value);
    try {
      const envelope = validatePluginRuntimeEnvelope(value);
      if (envelope.kind === 'shutdown') {
        port.close?.();
        return;
      }
      if (envelope.kind !== 'invoke' || !Object.hasOwn(runtime.tools, envelope.tool)) {
        postFailure(port, 'PROTOCOL_INVALID', envelope.kind === 'invoke' ? envelope.id : id);
        return;
      }
      const result = await runtime.tools[envelope.tool]!(envelope.args);
      validatePluginRuntimeEnvelope({ v: 1, kind: 'result', id: envelope.id, result });
      port.postMessage({ v: 1, kind: 'result', id: envelope.id, result });
    } catch {
      postFailure(port, 'PROTOCOL_INVALID', id);
    }
  });
}

function pluginUrlFromWorkerData(value: unknown): string | undefined {
  try {
    return isRecord(value) && typeof readDataProperty(value, 'pluginUrl') === 'string'
      ? readDataProperty(value, 'pluginUrl') as string
      : undefined;
  } catch {
    return undefined;
  }
}

if (parentPort) {
  const port = parentPort;
  const pluginUrl = pluginUrlFromWorkerData(workerData);
  if (!pluginUrl) {
    postFailure(port, 'PROTOCOL_INVALID');
  } else {
    void importMcpServerDefinition(pluginUrl)
      .then((runtime) => createPluginRuntimeDispatcher(runtime, port))
      .catch(() => postFailure(port, 'PROTOCOL_INVALID'));
  }
}
