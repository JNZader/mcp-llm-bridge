/**
 * ACP (Agent Client Protocol) Tests
 *
 * Tests for the ACP server, translator, and full request lifecycle.
 * Uses node:test runner and node:assert/strict.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AcpServer } from '../../src/acp/server.js';
import { AcpToMcpTranslator } from '../../src/acp/translator.js';
import { ACP_METHODS, ACP_ERROR_CODES } from '../../src/acp/types.js';
import type {
  JsonRpcRequest,
  AcpTask,
  AcpProgressNotification,
  AcpTaskUpdateNotification,
} from '../../src/acp/types.js';
import type { McpToolCallRequest, McpToolCallResult } from '../../src/acp/translator.js';

// ─── Test Helpers ────────────────────────────────────────────

function makeRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number = 1,
): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

function createMockHandler(response = { text: 'LLM response', provider: 'test', model: 'test-model' }) {
  const calls: Array<{ prompt: string; system?: string }> = [];
  const handler = async (params: { prompt: string; system?: string }) => {
    calls.push(params);
    return response;
  };
  return { handler, calls };
}

function createSlowHandler(delayMs: number) {
  return async (_params: { prompt: string; system?: string }) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { text: 'slow response', provider: 'test', model: 'test-model' };
  };
}

// ─── Translator Tests ────────────────────────────────────────

describe('AcpToMcpTranslator', () => {
  let translator: AcpToMcpTranslator;

  beforeEach(() => {
    translator = new AcpToMcpTranslator();
  });

  describe('buildSystemPrompt', () => {
    it('should return empty string for no contexts', () => {
      const result = translator.buildSystemPrompt([]);
      assert.equal(result, '');
    });

    it('should format file context with path and language', () => {
      const result = translator.buildSystemPrompt([
        { type: 'file', path: '/src/main.ts', content: 'const x = 1;', language: 'typescript' },
      ]);

      assert.ok(result.includes('File: /src/main.ts (typescript)'));
      assert.ok(result.includes('const x = 1;'));
    });

    it('should format snippet context as code block', () => {
      const result = translator.buildSystemPrompt([
        { type: 'snippet', content: 'function foo() {}', language: 'typescript' },
      ]);

      assert.ok(result.includes('```typescript'));
      assert.ok(result.includes('function foo() {}'));
      assert.ok(result.includes('```'));
    });

    it('should format selection context with range', () => {
      const result = translator.buildSystemPrompt([
        {
          type: 'selection',
          path: '/src/app.ts',
          content: 'selected code',
          range: { start: 10, end: 20 },
        },
      ]);

      assert.ok(result.includes('Selection in /src/app.ts (lines 10-20)'));
      assert.ok(result.includes('selected code'));
    });

    it('should combine multiple contexts', () => {
      const result = translator.buildSystemPrompt([
        { type: 'file', path: '/a.ts', content: 'file a' },
        { type: 'snippet', content: 'snippet b' },
      ]);

      assert.ok(result.includes('file a'));
      assert.ok(result.includes('snippet b'));
    });
  });

  describe('translateStartTask', () => {
    it('should create translation context from task params', () => {
      const result = translator.translateStartTask({
        description: 'Fix the bug',
        context: [{ type: 'file', path: '/bug.ts', content: 'buggy code' }],
      });

      assert.equal(result.description, 'Fix the bug');
      assert.ok(result.systemPrompt.includes('buggy code'));
      assert.deepEqual(result.userMessages, ['Fix the bug']);
      assert.deepEqual(result.toolCalls, []);
    });

    it('should handle missing context', () => {
      const result = translator.translateStartTask({
        description: 'Do something',
      });

      assert.equal(result.systemPrompt, '');
      assert.deepEqual(result.userMessages, ['Do something']);
    });
  });

  describe('translateSendMessage', () => {
    it('should append user message to existing context', () => {
      const existing = translator.translateStartTask({ description: 'Initial' });

      const result = translator.translateSendMessage(existing, {
        taskId: 'test',
        content: 'Follow up',
      });

      assert.deepEqual(result.userMessages, ['Initial', 'Follow up']);
    });

    it('should prefix system messages', () => {
      const existing = translator.translateStartTask({ description: 'Initial' });

      const result = translator.translateSendMessage(existing, {
        taskId: 'test',
        content: 'Override instruction',
        role: 'system',
      });

      assert.ok(result.userMessages[1]!.startsWith('[System] '));
    });
  });

  describe('translateToolResultsToAcp', () => {
    it('should aggregate tool results into ACP task result', () => {
      const calls: McpToolCallRequest[] = [
        { name: 'readFile', arguments: { path: '/a.ts' } },
        { name: 'writeFile', arguments: { path: '/b.ts', content: 'new' } },
      ];

      const results: McpToolCallResult[] = [
        { isError: false, content: [{ type: 'text', text: 'file contents' }] },
        { isError: false, content: [{ type: 'text', text: 'written successfully' }] },
      ];

      const acpResult = translator.translateToolResultsToAcp(calls, results);

      assert.ok(acpResult.content.includes('file contents'));
      assert.ok(acpResult.content.includes('written successfully'));
      assert.equal(acpResult.toolCalls!.length, 2);
      assert.equal(acpResult.toolCalls![0]!.toolName, 'readFile');
    });

    it('should skip error results in content', () => {
      const calls: McpToolCallRequest[] = [{ name: 'fail', arguments: {} }];
      const results: McpToolCallResult[] = [
        { isError: true, content: [{ type: 'text', text: 'error details' }] },
      ];

      const acpResult = translator.translateToolResultsToAcp(calls, results);

      assert.equal(acpResult.content, 'Task completed with no text output.');
    });

    it('should handle resource content blocks', () => {
      const calls: McpToolCallRequest[] = [{ name: 'getResource', arguments: {} }];
      const results: McpToolCallResult[] = [
        {
          isError: false,
          content: [
            { type: 'resource', resource: { uri: 'file:///a.ts', text: 'resource text' } },
          ],
        },
      ];

      const acpResult = translator.translateToolResultsToAcp(calls, results);

      assert.ok(acpResult.content.includes('resource text'));
    });
  });

  describe('buildGenerateRequest', () => {
    it('should build prompt and system from context', () => {
      const context = translator.translateStartTask({
        description: 'Refactor this',
        context: [{ type: 'file', path: '/x.ts', content: 'old code' }],
      });

      const req = translator.buildGenerateRequest(context);

      assert.equal(req.prompt, 'Refactor this');
      assert.ok(req.system!.includes('old code'));
    });

    it('should omit system when no context provided', () => {
      const context = translator.translateStartTask({ description: 'Hello' });
      const req = translator.buildGenerateRequest(context);

      assert.equal(req.prompt, 'Hello');
      assert.equal(req.system, undefined);
    });
  });
});

// ─── Server Tests ────────────────────────────────────────────

describe('AcpServer', () => {
  let server: AcpServer;
  let mock: ReturnType<typeof createMockHandler>;

  beforeEach(() => {
    mock = createMockHandler();
    server = new AcpServer(mock.handler);
  });

  describe('Initialize', () => {
    it('should return server capabilities', async () => {
      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test-editor', clientVersion: '1.0' },
        }),
      );

      assert.equal(response.error, undefined);
      const result = response.result as { serverCapabilities: { protocolVersion: string; features: string[] } };
      assert.equal(result.serverCapabilities.protocolVersion, '0.1.0');
      assert.ok(result.serverCapabilities.features.includes('tasks'));
      assert.ok(result.serverCapabilities.features.includes('messages'));
    });
  });

  describe('Server Not Initialized', () => {
    it('should reject requests before initialization', async () => {
      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'test' }),
      );

      assert.ok(response.error);
      assert.equal(response.error!.code, ACP_ERROR_CODES.SERVER_NOT_INITIALIZED);
    });
  });

  describe('Start Task', () => {
    it('should create a task and return it with pending status', async () => {
      // Initialize first
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Fix the bug in auth' }),
      );

      assert.equal(response.error, undefined);
      const result = response.result as { task: AcpTask };
      assert.ok(result.task.id);
      assert.equal(result.task.description, 'Fix the bug in auth');
      // Status may be pending or running depending on async timing
      assert.ok(['pending', 'running'].includes(result.task.status));
    });

    it('should reject empty description', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: '' }),
      );

      assert.ok(response.error);
      assert.equal(response.error!.code, ACP_ERROR_CODES.INVALID_PARAMS);
    });

    it('should pass context through translator to generate handler', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, {
          description: 'Analyze this file',
          context: [{ type: 'file', path: '/src/app.ts', content: 'const app = true;' }],
        }),
      );

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(mock.calls.length, 1);
      assert.equal(mock.calls[0]!.prompt, 'Analyze this file');
      assert.ok(mock.calls[0]!.system!.includes('const app = true;'));
    });

    it('should complete task after LLM responds', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Simple task' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      const getResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.GET_TASK, { taskId }),
      );

      const task = (getResponse.result as { task: AcpTask }).task;
      assert.equal(task.status, 'completed');
      assert.equal(task.result!.content, 'LLM response');
      assert.equal((task.result!.metadata as Record<string, string>).provider, 'test');
    });
  });

  describe('Cancel Task', () => {
    it('should cancel a running task', async () => {
      const slowServer = new AcpServer(createSlowHandler(500));

      await slowServer.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await slowServer.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Long task' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      // Cancel immediately
      const cancelResponse = await slowServer.handleRequest(
        makeRequest(ACP_METHODS.CANCEL_TASK, { taskId }),
      );

      assert.equal(cancelResponse.error, undefined);
      const task = (cancelResponse.result as { task: AcpTask }).task;
      assert.equal(task.status, 'cancelled');
    });

    it('should reject cancellation of completed task', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Quick task' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 50));

      const cancelResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.CANCEL_TASK, { taskId }),
      );

      assert.ok(cancelResponse.error);
      assert.equal(cancelResponse.error!.code, ACP_ERROR_CODES.TASK_ALREADY_COMPLETED);
    });
  });

  describe('Get Task', () => {
    it('should return task by ID', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'My task' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      const getResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.GET_TASK, { taskId }),
      );

      assert.equal(getResponse.error, undefined);
      const task = (getResponse.result as { task: AcpTask }).task;
      assert.equal(task.id, taskId);
      assert.equal(task.description, 'My task');
    });

    it('should return error for non-existent task', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.GET_TASK, { taskId: 'non-existent' }),
      );

      assert.ok(response.error);
      assert.equal(response.error!.code, ACP_ERROR_CODES.TASK_NOT_FOUND);
    });
  });

  describe('List Tasks', () => {
    it('should list all tasks', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Task 1' }),
      );
      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Task 2' }),
      );

      const listResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.LIST_TASKS, {}),
      );

      const tasks = (listResponse.result as { tasks: AcpTask[] }).tasks;
      assert.equal(tasks.length, 2);
    });

    it('should filter by status', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Task 1' }),
      );

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 50));

      const listResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.LIST_TASKS, { status: 'completed' }),
      );

      const tasks = (listResponse.result as { tasks: AcpTask[] }).tasks;
      assert.ok(tasks.length >= 1);
      assert.ok(tasks.every((t) => t.status === 'completed'));
    });

    it('should respect limit', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Task 1' }),
      );
      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Task 2' }),
      );
      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Task 3' }),
      );

      const listResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.LIST_TASKS, { limit: 2 }),
      );

      const tasks = (listResponse.result as { tasks: AcpTask[] }).tasks;
      assert.equal(tasks.length, 2);
    });
  });

  describe('Send Message', () => {
    it('should reject message to already-completed task', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Initial prompt' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      // Wait for execution to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send follow-up to completed task — should be rejected
      const msgResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.SEND_MESSAGE, {
          taskId,
          content: 'Also handle edge cases',
        }),
      );

      assert.ok(msgResponse.error);
      assert.equal(msgResponse.error.code, -32002);
    });

    it('should reject message to completed task', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Quick' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 50));

      const msgResponse = await server.handleRequest(
        makeRequest(ACP_METHODS.SEND_MESSAGE, { taskId, content: 'Too late' }),
      );

      assert.ok(msgResponse.error);
      assert.equal(msgResponse.error!.code, ACP_ERROR_CODES.TASK_ALREADY_COMPLETED);
    });
  });

  describe('Unknown Method', () => {
    it('should return METHOD_NOT_FOUND for unknown methods', async () => {
      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const response = await server.handleRequest(
        makeRequest('acp/unknownMethod', {}),
      );

      assert.ok(response.error);
      assert.equal(response.error!.code, ACP_ERROR_CODES.METHOD_NOT_FOUND);
    });
  });

  describe('Notifications', () => {
    it('should emit progress and task update notifications', async () => {
      const notifications: unknown[] = [];
      server.onNotification((n) => notifications.push(n));

      await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      await server.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Notify test' }),
      );

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have received progress + task update notifications
      assert.ok(notifications.length > 0);

      // Check that at least one progress notification exists
      const progressNotifs = notifications.filter(
        (n) => 'message' in (n as Record<string, unknown>) && 'taskId' in (n as Record<string, unknown>),
      ) as AcpProgressNotification[];
      assert.ok(progressNotifs.length > 0);

      // Check that at least one task update notification exists
      const taskUpdateNotifs = notifications.filter(
        (n) => 'task' in (n as Record<string, unknown>),
      ) as AcpTaskUpdateNotification[];
      assert.ok(taskUpdateNotifs.length > 0);
    });
  });

  describe('Error Handling', () => {
    it('should handle generate handler failures gracefully', async () => {
      const failingHandler = async () => {
        throw new Error('LLM is down');
      };
      const failServer = new AcpServer(failingHandler);

      await failServer.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      const startResponse = await failServer.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Will fail' }),
      );

      const taskId = (startResponse.result as { task: AcpTask }).task.id;

      // Wait for async execution to fail
      await new Promise((resolve) => setTimeout(resolve, 50));

      const getResponse = await failServer.handleRequest(
        makeRequest(ACP_METHODS.GET_TASK, { taskId }),
      );

      const task = (getResponse.result as { task: AcpTask }).task;
      assert.equal(task.status, 'failed');
      assert.ok(task.error);
      assert.ok(task.error!.message.includes('LLM is down'));
    });
  });

  describe('JSON-RPC Compliance', () => {
    it('should include jsonrpc version in response', async () => {
      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      assert.equal(response.jsonrpc, '2.0');
    });

    it('should echo request id in response', async () => {
      const response = await server.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }, 42),
      );

      assert.equal(response.id, 42);
    });
  });

  describe('Concurrent Task Limit', () => {
    it('should reject tasks beyond the concurrent limit', async () => {
      const slowServer = new AcpServer(createSlowHandler(5000), { maxConcurrentTasks: 2 });

      await slowServer.handleRequest(
        makeRequest(ACP_METHODS.INITIALIZE, {
          clientCapabilities: { clientName: 'test', clientVersion: '1.0' },
        }),
      );

      // Start 2 slow tasks (will stay running)
      await slowServer.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Slow 1' }),
      );

      // Small wait to ensure the first task transitions to 'running'
      await new Promise((resolve) => setTimeout(resolve, 20));

      await slowServer.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Slow 2' }),
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Third should be rejected
      const response = await slowServer.handleRequest(
        makeRequest(ACP_METHODS.START_TASK, { description: 'Too many' }),
      );

      assert.ok(response.error);
      assert.equal(response.error!.code, ACP_ERROR_CODES.INVALID_TASK_STATE);
    });
  });
});
