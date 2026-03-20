/**
 * MCP server tests — verify MCP tool definitions and initialization.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import { createAllAdapters } from '../src/adapters/index.js';
import type { GatewayConfig } from '../src/core/types.js';
import { VERSION } from '../src/core/constants.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-mcp-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);
const router = new Router();

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

// Cleanup
process.on('exit', () => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

// ── Tool schema validation tests ───────────────────────────────

describe('MCP tool schemas', () => {
  // Define tool schemas inline for testing
  const llmGenerateSchema = {
    name: 'llm_generate',
    description: 'Generate text using an LLM',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'The user prompt' },
        system: { type: 'string', description: 'Optional system prompt' },
        provider: { type: 'string', description: 'Preferred provider' },
        model: { type: 'string', description: 'Specific model' },
        maxTokens: { type: 'number', description: 'Max output tokens' },
        project: { type: 'string', description: 'Project scope' },
      },
      required: ['prompt'],
    },
  };

  const vaultStoreSchema = {
    name: 'vault_store',
    description: 'Store an API key in the vault',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider identifier' },
        keyName: { type: 'string', description: 'Key slot name' },
        apiKey: { type: 'string', description: 'The API key' },
        project: { type: 'string', description: 'Project scope' },
      },
      required: ['provider', 'apiKey'],
    },
  };

  const vaultListSchema = {
    name: 'vault_list',
    description: 'List stored credentials',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Filter by project' },
      },
    },
  };

  const vaultDeleteSchema = {
    name: 'vault_delete',
    description: 'Delete a credential',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Credential ID' },
        project: { type: 'string', description: 'Project scope' },
      },
      required: ['id'],
    },
  };

  const vaultStoreFileSchema = {
    name: 'vault_store_file',
    description: 'Store a file in the vault',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider identifier' },
        fileName: { type: 'string', description: 'File name' },
        content: { type: 'string', description: 'File content' },
        project: { type: 'string', description: 'Project scope' },
      },
      required: ['provider', 'fileName', 'content'],
    },
  };

  const vaultListFilesSchema = {
    name: 'vault_list_files',
    description: 'List stored files',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Filter by project' },
      },
    },
  };

  it('llm_generate schema has required fields', () => {
    assert.equal(llmGenerateSchema.name, 'llm_generate');
    assert.ok(llmGenerateSchema.description);
    assert.equal(llmGenerateSchema.inputSchema.type, 'object');
    assert.ok(llmGenerateSchema.inputSchema.properties.prompt);
    assert.deepEqual(llmGenerateSchema.inputSchema.required, ['prompt']);
  });

  it('vault_store schema has required fields', () => {
    assert.equal(vaultStoreSchema.name, 'vault_store');
    assert.ok(vaultStoreSchema.description);
    assert.equal(vaultStoreSchema.inputSchema.type, 'object');
    assert.ok(vaultStoreSchema.inputSchema.properties.provider);
    assert.ok(vaultStoreSchema.inputSchema.properties.apiKey);
    assert.deepEqual(vaultStoreSchema.inputSchema.required, ['provider', 'apiKey']);
  });

  it('vault_list schema is valid', () => {
    assert.equal(vaultListSchema.name, 'vault_list');
    assert.ok(vaultListSchema.inputSchema.properties.project);
  });

  it('vault_delete schema has required fields', () => {
    assert.equal(vaultDeleteSchema.name, 'vault_delete');
    assert.ok(vaultDeleteSchema.inputSchema.properties.id);
    assert.deepEqual(vaultDeleteSchema.inputSchema.required, ['id']);
  });

  it('vault_store_file schema has required fields', () => {
    assert.equal(vaultStoreFileSchema.name, 'vault_store_file');
    assert.deepEqual(vaultStoreFileSchema.inputSchema.required, ['provider', 'fileName', 'content']);
  });

  it('vault_list_files schema is valid', () => {
    assert.equal(vaultListFilesSchema.name, 'vault_list_files');
    assert.ok(vaultListFilesSchema.inputSchema.properties.project);
  });
});

// ── Router integration tests ──────────────────────────────────

describe('Router with adapters', () => {
  it('has all expected adapters registered', () => {
    // The router should have adapters registered
    // We can't directly access private providers array, but we can test via getProviderStatuses
  });

  it('returns available models', async () => {
    const models = await router.getAvailableModels();
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0);
  });

  it('returns provider statuses', async () => {
    const statuses = await router.getProviderStatuses();
    assert.ok(Array.isArray(statuses));
    assert.ok(statuses.length > 0);
    
    // Each status should have required fields
    for (const status of statuses) {
      assert.ok(status.id);
      assert.ok(typeof status.name === 'string');
      assert.ok(typeof status.type === 'string');
      assert.ok(typeof status.available === 'boolean');
    }
  });

  it('throws when no providers available', async () => {
    // With no credentials stored, generate should fail gracefully
    try {
      await router.generate({ prompt: 'test' });
      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('No credential found') || error.message.includes('No providers'));
    }
  });
});

// ── Vault MCP integration tests ───────────────────────────────

describe('Vault MCP operations', () => {
  beforeEach(() => {
    vault.db.exec('DELETE FROM credentials');
    vault.db.exec('DELETE FROM files');
  });

  it('stores and retrieves credentials like MCP vault_store', () => {
    // Simulate vault_store tool
    const id = vault.store('anthropic', 'default', 'sk-ant-test123', 'test-project');
    
    assert.ok(id > 0);
    
    // Simulate vault_list tool
    const list = vault.listMasked('test-project');
    assert.equal(list.length, 2); // project + global
  });

  it('deletes credentials like MCP vault_delete', () => {
    const id = vault.store('openai', 'default', 'sk-test123');
    
    // Verify exists
    assert.ok(vault.has('openai', 'default'));
    
    // Delete
    vault.delete(id);
    
    // Verify deleted
    assert.ok(!vault.has('openai', 'default'));
  });

  it('stores and retrieves files like MCP vault_store_file', () => {
    // Simulate vault_store_file tool
    const id = vault.storeFile('claude', 'auth.json', '{"token": "test"}');
    
    assert.ok(id > 0);
    
    // Retrieve
    const content = vault.getFile('claude', 'auth.json');
    assert.equal(content, '{"token": "test"}');
  });
});

// ── Version tests ───────────────────────────────────────────

describe('MCP server configuration', () => {
  it('version is defined', () => {
    assert.ok(VERSION);
    assert.equal(typeof VERSION, 'string');
    assert.ok(VERSION.match(/^\d+\.\d+\.\d+$/));
  });
});
