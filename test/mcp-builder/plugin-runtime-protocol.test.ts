import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LiveRequestIds,
  PLUGIN_RUNTIME_ERROR,
  PLUGIN_RUNTIME_LIMITS,
  PluginRuntimeProtocolError,
  createPluginRuntimeRequestId,
  validatePluginRuntimeEnvelope,
  validatePluginRuntimeManifest,
} from '../../src/mcp-builder/plugin-runtime-protocol.js';

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    name: 'demo_plugin',
    version: '1.0.0',
    description: 'A demo plugin',
    tools: [{
      name: 'search_docs',
      description: 'Search documentation',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      security: { category: 'read', requiresApproval: false },
    }],
    ...overrides,
  };
}

function expectProtocolError(action: () => unknown, code: string): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof PluginRuntimeProtocolError && error.code === code,
  );
}

describe('plugin runtime protocol', () => {
  it('admits each closed v1 envelope without changing ordinary JSON payloads', () => {
    const ready = { v: 1, kind: 'ready', manifest: manifest() };
    const invoke = { v: 1, kind: 'invoke', id: 'request-1', tool: 'search_docs', args: { query: 'hello' } };
    const result = { v: 1, kind: 'result', id: 'request-1', result: { matches: ['one'] } };
    const failure = { v: 1, kind: 'failure', id: 'request-1', code: PLUGIN_RUNTIME_ERROR.WORKER_EXITED };
    const shutdown = { v: 1, kind: 'shutdown' };

    for (const envelope of [ready, invoke, result, failure, shutdown]) {
      assert.strictEqual(validatePluginRuntimeEnvelope(envelope), envelope);
    }
  });

  it('rejects unknown, missing, or unsupported envelope fields and values', () => {
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 2, kind: 'shutdown' }), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'unknown' }), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'invoke', id: 'x', tool: 'search_docs' }), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'shutdown', extra: true }), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'failure', code: 'unbounded-code' }), 'PROTOCOL_INVALID');
  });

  it('validates closed manifests, tools, and security metadata against existing snake_case categories', () => {
    assert.strictEqual(validatePluginRuntimeManifest(manifest(), 'demo_plugin').name, 'demo_plugin');

    expectProtocolError(() => validatePluginRuntimeManifest(manifest({ handler: 'never-wire-handlers' })), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeManifest(manifest({ name: 'other_plugin' }), 'demo_plugin'), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeManifest(manifest({ tools: [{
      name: 'not snake case', description: 'Search documentation', inputSchema: {}, security: { category: 'read' },
    }] })), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeManifest(manifest({ tools: [{
      name: 'search_docs', description: 'Search documentation', inputSchema: {}, security: { category: 'read', extra: true },
    }] })), 'PROTOCOL_INVALID');
  });

  it('enforces numeric, encoded-byte, depth, node, string, and identifier bounds', () => {
    const oversizedId = 'a'.repeat(PLUGIN_RUNTIME_LIMITS.idBytes + 1);
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'invoke', id: oversizedId, tool: 'search_docs', args: {} }), 'LIMIT_EXCEEDED');
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'invoke', id: 'x', tool: 'search_docs', args: 'a'.repeat(PLUGIN_RUNTIME_LIMITS.stringBytes + 1) }), 'LIMIT_EXCEEDED');

    let tooDeep: unknown = 'leaf';
    for (let index = 0; index <= PLUGIN_RUNTIME_LIMITS.maxDepth; index += 1) tooDeep = { next: tooDeep };
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'invoke', id: 'x', tool: 'search_docs', args: tooDeep }), 'LIMIT_EXCEEDED');

    const encodedTooLarge = 'a'.repeat(PLUGIN_RUNTIME_LIMITS.envelopeBytes);
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'result', id: 'x', result: encodedTooLarge }), 'LIMIT_EXCEEDED');
  });

  it('rejects non-JSON values and accessors without treating them as safe wire values', () => {
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'result', id: 'x', result: Number.NaN }), 'PROTOCOL_INVALID');
    expectProtocolError(() => validatePluginRuntimeEnvelope({ v: 1, kind: 'result', id: 'x', result: new Date() }), 'PROTOCOL_INVALID');

    const hostile = { v: 1, kind: 'result', id: 'x' } as Record<string, unknown>;
    Object.defineProperty(hostile, 'result', { enumerable: true, get: () => { throw new Error('must not run'); } });
    expectProtocolError(() => validatePluginRuntimeEnvelope(hostile), 'PROTOCOL_INVALID');
  });

  it('creates collision-safe IDs and rejects duplicate live IDs', () => {
    const ids = new LiveRequestIds();
    const id = createPluginRuntimeRequestId();
    assert.match(id, /^[0-9a-f-]{36}$/i);
    ids.reserve(id);
    expectProtocolError(() => ids.reserve(id), 'PROTOCOL_INVALID');
    ids.release(id);
    ids.reserve(id);
  });
});
