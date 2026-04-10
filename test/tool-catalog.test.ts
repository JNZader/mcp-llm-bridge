import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolCatalog,
  type ToolEntry,
  type ToolSource,
} from '../src/tool-catalog/index.js';

// ── Registration ──

describe('ToolCatalog registration', () => {
  it('registers a tool with namespaced name', () => {
    const catalog = new ToolCatalog();
    catalog.register({
      name: 'generate_text',
      source: 'mcp',
      description: 'Generate text via LLM',
      parameters: { prompt: 'string' },
      tags: ['llm', 'generation'],
    });
    const tool = catalog.getByName('mcp:generate_text');
    assert.ok(tool);
    assert.equal(tool.name, 'generate_text');
    assert.equal(tool.namespace, 'mcp:generate_text');
  });

  it('rejects duplicate registration', () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: 'tool', source: 'mcp', description: 'A tool', parameters: {}, tags: [] });
    assert.throws(() => {
      catalog.register({ name: 'tool', source: 'mcp', description: 'Dup', parameters: {}, tags: [] });
    });
  });

  it('allows duplicate with force=true', () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: 'tool', source: 'mcp', description: 'V1', parameters: {}, tags: [] });
    catalog.register({ name: 'tool', source: 'mcp', description: 'V2', parameters: {}, tags: [] }, true);
    assert.equal(catalog.getByName('mcp:tool')?.description, 'V2');
  });

  it('registers bulk tools', () => {
    const catalog = new ToolCatalog();
    catalog.registerBulk([
      { name: 'a', source: 'mcp', description: 'Tool A', parameters: {}, tags: [] },
      { name: 'b', source: 'openapi', description: 'Tool B', parameters: {}, tags: [] },
      { name: 'c', source: 'graphql', description: 'Tool C', parameters: {}, tags: [] },
    ]);
    assert.equal(catalog.size, 3);
  });

  it('removes a tool', () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: 'temp', source: 'mcp', description: 'Temp', parameters: {}, tags: [] });
    assert.ok(catalog.remove('mcp:temp'));
    assert.equal(catalog.size, 0);
  });

  it('remove returns false for unknown tool', () => {
    const catalog = new ToolCatalog();
    assert.equal(catalog.remove('nope'), false);
  });
});

// ── Listing ──

describe('ToolCatalog listing', () => {
  it('lists all tools', () => {
    const catalog = new ToolCatalog();
    catalog.registerBulk([
      { name: 'a', source: 'mcp', description: 'A', parameters: {}, tags: [] },
      { name: 'b', source: 'openapi', description: 'B', parameters: {}, tags: [] },
    ]);
    assert.equal(catalog.listAll().length, 2);
  });

  it('filters by source', () => {
    const catalog = new ToolCatalog();
    catalog.registerBulk([
      { name: 'a', source: 'mcp', description: 'A', parameters: {}, tags: [] },
      { name: 'b', source: 'openapi', description: 'B', parameters: {}, tags: [] },
      { name: 'c', source: 'mcp', description: 'C', parameters: {}, tags: [] },
    ]);
    const mcp = catalog.listAll('mcp');
    assert.equal(mcp.length, 2);
    assert.ok(mcp.every(t => t.source === 'mcp'));
  });

  it('getByName resolves namespaced', () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: 'tool', source: 'mcp', description: 'T', parameters: {}, tags: [] });
    assert.ok(catalog.getByName('mcp:tool'));
  });

  it('getByName resolves bare name', () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: 'unique_tool', source: 'mcp', description: 'T', parameters: {}, tags: [] });
    assert.ok(catalog.getByName('unique_tool'));
  });

  it('getByName returns null for unknown', () => {
    const catalog = new ToolCatalog();
    assert.equal(catalog.getByName('nope'), null);
  });
});

// ── Search ──

describe('ToolCatalog search', () => {
  function buildSearchCatalog(): ToolCatalog {
    const catalog = new ToolCatalog();
    catalog.registerBulk([
      { name: 'generate_text', source: 'mcp', description: 'Generate text using an LLM model', parameters: {}, tags: ['llm', 'generation', 'text'] },
      { name: 'search_code', source: 'mcp', description: 'Search code in repository using semantic matching', parameters: {}, tags: ['code', 'search', 'repository'] },
      { name: 'create_user', source: 'openapi', description: 'Create a new user account via REST API', parameters: {}, tags: ['user', 'rest', 'create'] },
      { name: 'get_schema', source: 'graphql', description: 'Introspect GraphQL schema and return types', parameters: {}, tags: ['graphql', 'schema', 'types'] },
      { name: 'file_read', source: 'mcp', description: 'Read file contents from filesystem', parameters: {}, tags: ['file', 'read', 'filesystem'] },
    ]);
    return catalog;
  }

  it('finds tools by keyword in description', () => {
    const catalog = buildSearchCatalog();
    const results = catalog.search('generate text');
    assert.ok(results.length >= 1);
    assert.equal(results[0]!.name, 'generate_text');
  });

  it('finds tools by tag', () => {
    const catalog = buildSearchCatalog();
    const results = catalog.search('graphql');
    assert.ok(results.some(r => r.name === 'get_schema'));
  });

  it('finds tools by name', () => {
    const catalog = buildSearchCatalog();
    const results = catalog.search('file_read');
    assert.ok(results.some(r => r.name === 'file_read'));
  });

  it('respects limit', () => {
    const catalog = buildSearchCatalog();
    const results = catalog.search('a', 2);
    assert.ok(results.length <= 2);
  });

  it('returns empty for no match', () => {
    const catalog = buildSearchCatalog();
    const results = catalog.search('xyznonexistent');
    assert.equal(results.length, 0);
  });

  it('ranks by relevance (name match > description > tag)', () => {
    const catalog = buildSearchCatalog();
    const results = catalog.search('search code');
    // search_code should be first (matches name + description)
    assert.equal(results[0]!.name, 'search_code');
  });
});

// ── Serialization ──

describe('ToolCatalog serialization', () => {
  it('roundtrips through JSON', () => {
    const catalog = new ToolCatalog();
    catalog.registerBulk([
      { name: 'a', source: 'mcp', description: 'Tool A', parameters: { x: 'number' }, tags: ['test'] },
      { name: 'b', source: 'openapi', description: 'Tool B', parameters: {}, tags: [] },
    ]);
    const json = catalog.toJSON();
    const restored = ToolCatalog.fromJSON(json);
    assert.equal(restored.size, 2);
    assert.equal(restored.getByName('mcp:a')?.description, 'Tool A');
  });

  it('empty catalog serializes to empty array', () => {
    const catalog = new ToolCatalog();
    const json = catalog.toJSON();
    const restored = ToolCatalog.fromJSON(json);
    assert.equal(restored.size, 0);
  });
});
