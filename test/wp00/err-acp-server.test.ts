import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AcpServer } from '../../src/acp/server.js';
import { ACP_METHODS } from '../../src/acp/types.js';
import type { AcpTaskUpdateNotification, JsonRpcResponse } from '../../src/acp/types.js';

const CANARY = 'private-acp-error-canary';
const SAFE = 'An unexpected internal error occurred.';
const OUTPUT = { text: 'Intentional output', provider: 'fixture', model: 'fixture-model' };
const initialize = { clientCapabilities: { clientName: 'fixture', clientVersion: '1' } };

function request(server: AcpServer, method: string, params?: Record<string, unknown>) {
  return server.handleRequest({ jsonrpc: '2.0', id: 1, method, params });
}

function expectError(response: JsonRpcResponse, code: number, message: string) {
  assert.deepEqual(response, { jsonrpc: '2.0', id: 1, error: { code, message } });
  assert.equal(JSON.stringify(response).includes(CANARY), false);
}

function hostile(kind: string, inspect: () => never): unknown {
  if (kind === 'string') return CANARY;
  if (kind === 'getter') return Object.defineProperty(new Error(), 'message', { get: inspect });
  if (kind === 'coercion') return { [Symbol.toPrimitive]: inspect, toString: inspect };
  if (kind === 'proxy') return new Proxy({}, { get: inspect, getPrototypeOf: inspect });
  if (kind === 'revoked') {
    const value = Proxy.revocable({}, {});
    value.revoke();
    return value.proxy;
  }
  if (kind === 'imitation') return { code: -32001, message: CANARY };
  return new Error(CANARY);
}

// A single event-loop turn settles the already-resolved/rejected local handler.
// No provider, timer-based polling, socket or stdio transport is involved.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ACP server error containment', () => {
  for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'imitation']) {
    it('contains unknown request failure ' + kind + ' without inspecting it', async () => {
      let accesses = 0;
      const value = hostile(kind, () => { accesses++; throw new Error(CANARY); });
      // Defensive in-process input getter; this is not a JSON transport exploit.
      const params = Object.defineProperty({}, 'clientCapabilities', { get() { throw value; } });
      const server = new AcpServer(async () => { assert.fail('Unexpected generation'); });
      expectError(await request(server, ACP_METHODS.INITIALIZE, params), -32603, SAFE);
      assert.equal(accesses, 0);
      assert.equal(server.taskCount, 0);
    });

    it('contains task execution failure ' + kind + ' in notifications and readback', async () => {
      let accesses = 0;
      const value = hostile(kind, () => { accesses++; throw new Error(CANARY); });
      const server = new AcpServer(async () => { throw value; });
      const updates: AcpTaskUpdateNotification[] = [];
      server.onNotification((notification) => { if ('task' in notification) updates.push(notification); });
      await request(server, ACP_METHODS.INITIALIZE, initialize);
      await request(server, ACP_METHODS.START_TASK, { description: 'Intentional task' });
      await settle();
      const task = server.getTask('acp-task-1');
      assert.ok(task);
      assert.equal(task.status, 'failed');
      assert.deepEqual(task.error, { code: 'EXECUTION_ERROR', message: SAFE });
      assert.equal(task.description, 'Intentional task');
      assert.deepEqual(updates.map((entry) => entry.task.status), ['running', 'failed']);
      const result = await request(server, ACP_METHODS.GET_TASK, { taskId: task.id });
      assert.deepEqual(result.result, { task });
      assert.equal(JSON.stringify({ result, updates }).includes(CANARY), false);
      assert.equal(accesses, 0);
    });
  }

  const protocolCases = [
    { name: 'not initialized', method: ACP_METHODS.GET_TASK, params: { taskId: CANARY }, code: -32005, message: 'Server is not initialized.', ready: false },
    { name: 'missing task', method: ACP_METHODS.GET_TASK, params: { taskId: CANARY }, code: -32001, message: 'Task was not found.', ready: true },
    { name: 'unknown method', method: CANARY, params: {}, code: -32601, message: 'Method was not found.', ready: true },
    { name: 'invalid parameters', method: ACP_METHODS.START_TASK, params: { description: '' }, code: -32602, message: 'Invalid parameters.', ready: true },
  ];
  for (const entry of protocolCases) {
    it('preserves genuine numeric code for ' + entry.name, async () => {
      const server = new AcpServer(async () => { assert.fail('Unexpected generation'); });
      if (entry.ready) await request(server, ACP_METHODS.INITIALIZE, initialize);
      expectError(await request(server, entry.method, entry.params), entry.code, entry.message);
      assert.equal(server.taskCount, 0);
    });
  }

  it('preserves successful initialization, generation, readback and completed-task rejection', async () => {
    const calls: unknown[] = [];
    const server = new AcpServer(async (params) => { calls.push(params); return OUTPUT; });
    const init = await request(server, ACP_METHODS.INITIALIZE, initialize);
    assert.deepEqual(init.result, { serverCapabilities: { protocolVersion: '0.1.0',
      serverName: 'mcp-llm-bridge', serverVersion: '0.4.0', features: ['tasks', 'messages', 'cancellation', 'progress'] } });
    await request(server, ACP_METHODS.START_TASK, { description: 'Intentional task' });
    await settle();
    const task = server.getTask('acp-task-1');
    assert.ok(task);
    assert.equal(task.status, 'completed');
    assert.deepEqual(task.result, { content: OUTPUT.text, metadata: { provider: OUTPUT.provider, model: OUTPUT.model } });
    assert.equal(calls.length, 1);
    const list = await request(server, ACP_METHODS.LIST_TASKS, { status: 'completed', limit: 1 });
    assert.deepEqual(list.result, { tasks: [task] });
    expectError(await request(server, ACP_METHODS.SEND_MESSAGE, { taskId: task.id, content: CANARY }),
      -32002, 'Task is already completed.');
    assert.equal(calls.length, 1);
  });

  it('preserves concurrency rejection and cancellation without late result resurrection', async () => {
    let release: (result: typeof OUTPUT) => void = () => { assert.fail('Handler not created'); };
    const pending = new Promise<typeof OUTPUT>((resolve) => { release = resolve; });
    const server = new AcpServer(async () => pending, { maxConcurrentTasks: 1 });
    await request(server, ACP_METHODS.INITIALIZE, initialize);
    try {
      await request(server, ACP_METHODS.START_TASK, { description: 'Intentional task' });
      expectError(await request(server, ACP_METHODS.START_TASK, { description: CANARY }),
        -32004, 'Task state is invalid.');
      const cancelled = await request(server, ACP_METHODS.CANCEL_TASK, { taskId: 'acp-task-1', reason: CANARY });
      assert.deepEqual(cancelled.result, { task: server.getTask('acp-task-1') });
      assert.equal(server.getTask('acp-task-1')?.status, 'cancelled');
      expectError(await request(server, ACP_METHODS.SEND_MESSAGE, { taskId: 'acp-task-1', content: CANARY }),
        -32003, 'Task was cancelled.');
    } finally { release(OUTPUT); await settle(); }
    assert.equal(server.getTask('acp-task-1')?.status, 'cancelled');
    assert.equal(server.getTask('acp-task-1')?.result, undefined);
  });
});
