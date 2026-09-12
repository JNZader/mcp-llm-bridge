import { randomUUID } from 'node:crypto';

export const PLUGIN_RUNTIME_ERROR = {
  CONFIG_INVALID: 'CONFIG_INVALID',
  COMPATIBILITY_UNESTABLISHED: 'COMPATIBILITY_UNESTABLISHED',
  PROTOCOL_INVALID: 'PROTOCOL_INVALID',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  IMPORT_TIMEOUT: 'IMPORT_TIMEOUT',
  WORKER_EXITED: 'WORKER_EXITED',
  INVOCATION_TIMEOUT: 'INVOCATION_TIMEOUT',
  PLUGIN_QUARANTINED: 'PLUGIN_QUARANTINED',
} as const;

export type PluginRuntimeErrorCode = (typeof PLUGIN_RUNTIME_ERROR)[keyof typeof PLUGIN_RUNTIME_ERROR];

export const PLUGIN_RUNTIME_LIMITS = {
  envelopeBytes: 1024 * 1024,
  maxDepth: 32,
  maxNodes: 10_000,
  stringBytes: 256 * 1024,
  idBytes: 128,
} as const;

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SECURITY_CATEGORIES = new Set(['read', 'generate', 'destructive', 'admin']);
const STABLE_ERROR_CODES = new Set<string>(Object.values(PLUGIN_RUNTIME_ERROR));

export class PluginRuntimeProtocolError extends Error {
  constructor(public readonly code: PluginRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'PluginRuntimeProtocolError';
  }
}

export interface PluginRuntimeSecurity {
  category: 'read' | 'generate' | 'destructive' | 'admin';
  requiresApproval?: boolean;
}

export interface PluginRuntimeToolManifest {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  security: PluginRuntimeSecurity;
}

export interface PluginRuntimeManifest {
  v: 1;
  name: string;
  version: string;
  description: string;
  tools: PluginRuntimeToolManifest[];
}

export type PluginRuntimeEnvelope =
  | { v: 1; kind: 'ready'; manifest: PluginRuntimeManifest }
  | { v: 1; kind: 'invoke'; id: string; tool: string; args: unknown }
  | { v: 1; kind: 'result'; id: string; result: unknown }
  | { v: 1; kind: 'failure'; id?: string; code: PluginRuntimeErrorCode }
  | { v: 1; kind: 'shutdown' };

interface JsonMetrics {
  count: number;
}

function protocolInvalid(message: string): never {
  throw new PluginRuntimeProtocolError('PROTOCOL_INVALID', message);
}

function limitExceeded(message: string): never {
  throw new PluginRuntimeProtocolError('LIMIT_EXCEEDED', message);
}

function increment(metrics: JsonMetrics, amount = 1): void {
  metrics.count += amount;
  if (metrics.count > PLUGIN_RUNTIME_LIMITS.maxNodes) limitExceeded('JSON value exceeds the node limit.');
}

function ownDataProperties(value: object): Record<string, PropertyDescriptor> {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) protocolInvalid('Protocol value must be plain JSON data.');

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') protocolInvalid('Protocol value must not contain symbol keys.');
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        protocolInvalid('Protocol value must not contain accessors or hidden fields.');
      }
    }
    return descriptors;
  } catch (error) {
    if (error instanceof PluginRuntimeProtocolError) throw error;
    protocolInvalid('Protocol value could not be inspected.');
  }
}

function validateJson(value: unknown, depth: number, metrics: JsonMetrics): void {
  if (depth > PLUGIN_RUNTIME_LIMITS.maxDepth) limitExceeded('JSON value exceeds the depth limit.');
  increment(metrics);

  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > PLUGIN_RUNTIME_LIMITS.stringBytes) limitExceeded('JSON string exceeds the byte limit.');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) protocolInvalid('Protocol number must be finite.');
    return;
  }
  if (typeof value !== 'object') protocolInvalid('Protocol value must be JSON-compatible.');

  if (Array.isArray(value)) {
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype) protocolInvalid('Protocol array must be plain JSON data.');
      const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
      const lengthDescriptor = descriptors['length'];
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || typeof lengthDescriptor.value !== 'number') {
        protocolInvalid('Protocol array could not be inspected.');
      }
      const length = lengthDescriptor.value;
      for (const key of Reflect.ownKeys(descriptors)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) protocolInvalid('Protocol array contains invalid keys.');
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) protocolInvalid('Protocol array must not contain accessors.');
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) protocolInvalid('Protocol array must not contain holes.');
        increment(metrics);
        validateJson(descriptor.value, depth + 1, metrics);
      }
      return;
    } catch (error) {
      if (error instanceof PluginRuntimeProtocolError) throw error;
      protocolInvalid('Protocol array could not be inspected.');
    }
  }

  const descriptors = ownDataProperties(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    increment(metrics);
    if (Buffer.byteLength(key, 'utf8') > PLUGIN_RUNTIME_LIMITS.stringBytes) limitExceeded('JSON key exceeds the byte limit.');
    validateJson(descriptor.value, depth + 1, metrics);
  }
}

function validateBoundedJson(value: unknown, enforceEnvelopeSize: boolean): void {
  validateJson(value, 1, { count: 0 });
  if (!enforceEnvelopeSize) return;

  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    protocolInvalid('Protocol value could not be encoded.');
  }
  if (encoded === undefined) protocolInvalid('Protocol value must be JSON-compatible.');
  if (Buffer.byteLength(encoded, 'utf8') > PLUGIN_RUNTIME_LIMITS.envelopeBytes) {
    limitExceeded('Protocol envelope exceeds the byte limit.');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) protocolInvalid('Protocol value must be an object.');
  ownDataProperties(value);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    protocolInvalid('Protocol object fields are invalid.');
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateId(value: unknown): asserts value is string {
  if (!nonEmptyString(value)) protocolInvalid('Protocol request ID is invalid.');
  if (Buffer.byteLength(value, 'utf8') > PLUGIN_RUNTIME_LIMITS.idBytes) limitExceeded('Protocol request ID exceeds the byte limit.');
}

function validateToolManifest(value: unknown): PluginRuntimeToolManifest {
  const tool = asRecord(value);
  exactKeys(tool, ['name', 'description', 'inputSchema', 'security']);
  if (!nonEmptyString(tool['name']) || !SNAKE_CASE.test(tool['name']) || !nonEmptyString(tool['description'])) {
    protocolInvalid('Plugin tool manifest is invalid.');
  }
  const inputSchema = asRecord(tool['inputSchema']);
  validateBoundedJson(inputSchema, false);
  const security = asRecord(tool['security']);
  const keys = Object.keys(security).sort();
  if ((keys.length !== 1 && keys.length !== 2) || keys[0] !== 'category' || (keys.length === 2 && keys[1] !== 'requiresApproval')) {
    protocolInvalid('Plugin tool security metadata is invalid.');
  }
  if (typeof security['category'] !== 'string' || !SECURITY_CATEGORIES.has(security['category'])) {
    protocolInvalid('Plugin tool security category is invalid.');
  }
  if (security['requiresApproval'] !== undefined && typeof security['requiresApproval'] !== 'boolean') {
    protocolInvalid('Plugin tool requiresApproval must be boolean.');
  }
  return tool as unknown as PluginRuntimeToolManifest;
}

export function validatePluginRuntimeManifest(value: unknown, expectedName?: string): PluginRuntimeManifest {
  validateBoundedJson(value, true);
  const manifest = asRecord(value);
  exactKeys(manifest, ['v', 'name', 'version', 'description', 'tools']);
  if (manifest['v'] !== 1 || !nonEmptyString(manifest['name']) || !nonEmptyString(manifest['version'])
    || !nonEmptyString(manifest['description']) || !Array.isArray(manifest['tools'])) {
    protocolInvalid('Plugin manifest is invalid.');
  }
  if (expectedName !== undefined && manifest['name'] !== expectedName) protocolInvalid('Plugin manifest identity does not match its filename.');
  for (const tool of manifest['tools']) validateToolManifest(tool);
  return manifest as unknown as PluginRuntimeManifest;
}

export function validatePluginRuntimeEnvelope(value: unknown): PluginRuntimeEnvelope {
  validateBoundedJson(value, true);
  const envelope = asRecord(value);
  if (envelope['v'] !== 1 || typeof envelope['kind'] !== 'string') protocolInvalid('Protocol envelope is invalid.');

  switch (envelope['kind']) {
    case 'ready':
      exactKeys(envelope, ['v', 'kind', 'manifest']);
      validatePluginRuntimeManifest(envelope['manifest']);
      break;
    case 'invoke':
      exactKeys(envelope, ['v', 'kind', 'id', 'tool', 'args']);
      validateId(envelope['id']);
      if (!nonEmptyString(envelope['tool']) || !SNAKE_CASE.test(envelope['tool'])) protocolInvalid('Protocol tool name is invalid.');
      break;
    case 'result':
      exactKeys(envelope, ['v', 'kind', 'id', 'result']);
      validateId(envelope['id']);
      break;
    case 'failure':
      if (Object.hasOwn(envelope, 'id')) {
        exactKeys(envelope, ['v', 'kind', 'id', 'code']);
        validateId(envelope['id']);
      } else {
        exactKeys(envelope, ['v', 'kind', 'code']);
      }
      if (typeof envelope['code'] !== 'string' || !STABLE_ERROR_CODES.has(envelope['code'])) protocolInvalid('Protocol failure code is invalid.');
      break;
    case 'shutdown':
      exactKeys(envelope, ['v', 'kind']);
      break;
    default:
      protocolInvalid('Protocol envelope kind is invalid.');
  }

  return envelope as unknown as PluginRuntimeEnvelope;
}

export function createPluginRuntimeRequestId(): string {
  return randomUUID();
}

export class LiveRequestIds {
  private readonly live = new Set<string>();

  reserve(id: string): void {
    validateId(id);
    if (this.live.has(id)) protocolInvalid('Protocol request ID is already live.');
    this.live.add(id);
  }

  release(id: string): void {
    this.live.delete(id);
  }
}
