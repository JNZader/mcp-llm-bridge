/**
 * MCP Builder — tests for server scaffolding and validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  McpServerBuilder,
  scaffoldTool,
  textResult,
  errorResult,
} from '../../src/mcp-builder/index.js';
import type { ToolPattern } from '../../src/mcp-builder/index.js';

function makeHandler() {
  return async () => textResult('ok');
}

describe('McpServerBuilder', () => {
  it('builds a valid server definition', () => {
    const builder = new McpServerBuilder('test-server', 'A test MCP server');
    builder.addTool({
      name: 'search_code',
      description: 'Search for code snippets in the codebase by keyword',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      handler: makeHandler(),
    });

    const def = builder.build();
    assert.equal(def.name, 'test-server');
    assert.equal(def.tools.length, 1);
    assert.equal(def.tools[0]!.name, 'search_code');
  });

  it('rejects non-snake_case tool names', () => {
    const builder = new McpServerBuilder('test', 'desc');
    builder.addTool({
      name: 'searchCode',
      description: 'Search for code snippets in the project',
      inputSchema: { type: 'object' },
      handler: makeHandler(),
    });

    assert.throws(() => builder.build(), /snake_case/);
  });

  it('rejects duplicate tool names', () => {
    const builder = new McpServerBuilder('test', 'desc');
    const tool: ToolPattern = {
      name: 'search_code',
      description: 'Search for code snippets in the project',
      inputSchema: { type: 'object' },
      handler: makeHandler(),
    };
    builder.addTool(tool);
    builder.addTool(tool);

    assert.throws(() => builder.build(), /Duplicate tool name/);
  });

  it('validates resource URI format', () => {
    const builder = new McpServerBuilder('test', 'desc');
    builder.addResource({
      uri: 'not-a-uri',
      name: 'Bad Resource',
      mimeType: 'text/plain',
      handler: async () => ({ contents: [] }),
    });

    const issues = builder.validate();
    assert.ok(issues.some((i) => i.severity === 'error' && i.message.includes('URI')));
  });

  it('accepts valid resource URIs', () => {
    const builder = new McpServerBuilder('test', 'desc');
    builder.addResource({
      uri: 'data://items',
      name: 'Items',
      mimeType: 'application/json',
      handler: async () => ({ contents: [{ uri: 'data://items', text: '[]', mimeType: 'application/json' }] }),
    });

    const issues = builder.validate();
    const errors = issues.filter((i) => i.severity === 'error');
    assert.equal(errors.length, 0);
  });

  it('validates prompt naming', () => {
    const builder = new McpServerBuilder('test', 'desc');
    builder.addPrompt({
      name: 'BadName',
      description: 'This prompt has a bad name format',
      arguments: [],
      handler: async () => ({ messages: [] }),
    });

    const issues = builder.validate();
    assert.ok(issues.some((i) => i.message.includes('snake_case')));
  });

  it('warns when server has no capabilities', () => {
    const builder = new McpServerBuilder('empty', 'desc');
    const issues = builder.validate();
    assert.ok(issues.some((i) => i.severity === 'warning' && i.message.includes('no tools')));
  });

  it('sets version', () => {
    const builder = new McpServerBuilder('test', 'desc');
    builder.setVersion('2.0.0');
    builder.addTool({
      name: 'ping',
      description: 'A simple health check ping tool',
      inputSchema: { type: 'object' },
      handler: makeHandler(),
    });

    const def = builder.build();
    assert.equal(def.version, '2.0.0');
  });

  it('adds prompts to the definition', () => {
    const builder = new McpServerBuilder('test', 'desc');
    builder.addPrompt({
      name: 'summarize_code',
      description: 'Summarize a code file for documentation',
      arguments: [{ name: 'file', description: 'File path', required: true }],
      handler: async () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Summarize this' } }],
      }),
    });

    const def = builder.build();
    assert.equal(def.prompts.length, 1);
    assert.equal(def.prompts[0]!.name, 'summarize_code');
  });
});

describe('scaffoldTool', () => {
  it('creates a tool pattern with JSON schema', () => {
    const tool = scaffoldTool(
      'search_files',
      'Search files by pattern',
      { query: { type: 'string', description: 'Search query' } },
      ['query'],
    );

    assert.equal(tool.name, 'search_files');
    assert.deepEqual((tool.inputSchema as Record<string, unknown>)['required'], ['query']);
  });
});

describe('textResult / errorResult', () => {
  it('creates text result', () => {
    const result = textResult('hello');
    assert.equal(result.content[0]!.type, 'text');
    assert.equal((result.content[0] as { text: string }).text, 'hello');
    assert.equal(result.isError, false);
  });

  it('creates error result', () => {
    const result = errorResult('something broke');
    assert.equal(result.isError, true);
    assert.equal((result.content[0] as { text: string }).text, 'something broke');
  });
});
