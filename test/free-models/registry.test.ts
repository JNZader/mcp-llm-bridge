/**
 * Free Model Registry tests — model management, validation, user config loading.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FreeModelRegistry,
  BUILTIN_FREE_MODELS,
  validateEntry,
  loadUserModels,
} from '../../src/free-models/registry.js';
import type { FreeModelEntry } from '../../src/free-models/types.js';

// ── Validation ──────────────────────────────────────────────

describe('validateEntry', () => {
  it('accepts a valid entry', () => {
    const entry: FreeModelEntry = {
      id: 'test-model',
      name: 'Test Model',
      source: 'test',
      baseUrl: 'https://api.test.com/v1',
      modelId: 'test/model-7b',
      capabilities: ['chat'],
      maxTokens: 4096,
      enabled: true,
    };
    const errors = validateEntry(entry);
    assert.equal(errors.length, 0);
  });

  it('rejects non-object input', () => {
    const errors = validateEntry('not-an-object');
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.includes('must be an object'));
  });

  it('rejects entry with missing id', () => {
    const errors = validateEntry({
      name: 'Test',
      source: 'test',
      baseUrl: 'https://api.test.com',
      modelId: 'test',
      capabilities: ['chat'],
      maxTokens: 4096,
    });
    assert.ok(errors.some((e) => e.includes('id')));
  });

  it('rejects entry with empty baseUrl', () => {
    const errors = validateEntry({
      id: 'test',
      name: 'Test',
      source: 'test',
      baseUrl: '',
      modelId: 'test',
      capabilities: ['chat'],
      maxTokens: 4096,
    });
    assert.ok(errors.some((e) => e.includes('baseUrl')));
  });

  it('rejects entry with non-positive maxTokens', () => {
    const errors = validateEntry({
      id: 'test',
      name: 'Test',
      source: 'test',
      baseUrl: 'https://api.test.com',
      modelId: 'test',
      capabilities: ['chat'],
      maxTokens: 0,
    });
    assert.ok(errors.some((e) => e.includes('maxTokens')));
  });

  it('rejects entry with non-array capabilities', () => {
    const errors = validateEntry({
      id: 'test',
      name: 'Test',
      source: 'test',
      baseUrl: 'https://api.test.com',
      modelId: 'test',
      capabilities: 'chat',
      maxTokens: 4096,
    });
    assert.ok(errors.some((e) => e.includes('capabilities')));
  });
});

// ── Registry ──────────────────────────────────────────────

describe('FreeModelRegistry', () => {
  it('loads built-in models by default', () => {
    const registry = new FreeModelRegistry();
    assert.ok(registry.size >= BUILTIN_FREE_MODELS.length);
    for (const builtin of BUILTIN_FREE_MODELS) {
      assert.ok(registry.get(builtin.id), `Missing built-in: ${builtin.id}`);
    }
  });

  it('user models override built-ins by ID', () => {
    const override: FreeModelEntry = {
      ...BUILTIN_FREE_MODELS[0]!,
      name: 'Custom Override',
      baseUrl: 'https://custom.example.com/v1',
    };
    const registry = new FreeModelRegistry([override]);

    const result = registry.get(override.id);
    assert.equal(result?.name, 'Custom Override');
    assert.equal(result?.baseUrl, 'https://custom.example.com/v1');
  });

  it('user models add new entries', () => {
    const custom: FreeModelEntry = {
      id: 'custom-model-xyz',
      name: 'Custom XYZ',
      source: 'custom',
      baseUrl: 'https://custom.example.com/v1',
      modelId: 'custom/xyz',
      capabilities: ['chat', 'code'],
      maxTokens: 8192,
      enabled: true,
    };
    const registry = new FreeModelRegistry([custom]);

    assert.equal(registry.size, BUILTIN_FREE_MODELS.length + 1);
    assert.ok(registry.get('custom-model-xyz'));
  });

  it('getEnabled() filters disabled models', () => {
    const disabled: FreeModelEntry = {
      id: 'disabled-model',
      name: 'Disabled',
      source: 'test',
      baseUrl: 'https://test.com',
      modelId: 'test',
      capabilities: ['chat'],
      maxTokens: 4096,
      enabled: false,
    };
    const registry = new FreeModelRegistry([disabled]);

    const enabled = registry.getEnabled();
    assert.ok(!enabled.some((m) => m.id === 'disabled-model'));
  });

  it('getByCapability() filters by capability', () => {
    const registry = new FreeModelRegistry();
    const codeModels = registry.getByCapability('code');

    for (const model of codeModels) {
      assert.ok(model.capabilities.includes('code'));
    }
  });

  it('getAll() includes disabled models', () => {
    const disabled: FreeModelEntry = {
      id: 'disabled-model',
      name: 'Disabled',
      source: 'test',
      baseUrl: 'https://test.com',
      modelId: 'test',
      capabilities: ['chat'],
      maxTokens: 4096,
      enabled: false,
    };
    const registry = new FreeModelRegistry([disabled]);

    const all = registry.getAll();
    assert.ok(all.some((m) => m.id === 'disabled-model'));
  });
});

// ── User Config Loading ──────────────────────────────────

describe('loadUserModels', () => {
  it('returns empty array for non-existent path', () => {
    const result = loadUserModels('/tmp/nonexistent-free-models.json');
    assert.deepEqual(result, []);
  });
});
