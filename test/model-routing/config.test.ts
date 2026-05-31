/**
 * Model routing config loader tests.
 *
 * Uses temporary files in the project root (where loadConfig expects
 * model-routing.json) and restores the original file after each test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/model-routing/config.js';

// ── Setup ─────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');
const configPath = resolve(projectRoot, 'model-routing.json');
const originalContent = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null;

function writeConfig(config: unknown): void {
  writeFileSync(configPath, typeof config === 'string' ? config : JSON.stringify(config, null, 2), 'utf-8');
}

function restoreOriginal(): void {
  if (originalContent !== null) {
    writeFileSync(configPath, originalContent, 'utf-8');
  } else if (existsSync(configPath)) {
    unlinkSync(configPath);
  }
}

function validBaseConfig(): Record<string, unknown> {
  return {
    enabled: true,
    endpoints: [
      {
        id: 'test-local',
        providerId: 'opencode-cli',
        model: 'test-model',
        costTier: 'free',
        capabilities: ['chat', 'code'],
        maxTokens: 4096,
      },
    ],
    rules: [
      {
        id: 'rule-default',
        taskType: '*',
        preferredEndpoints: ['test-local'],
        maxCostTier: 'free',
        minQuality: 'low',
        allowFallback: false,
      },
    ],
    defaultEndpoint: 'test-local',
    qualityThreshold: 0.7,
    qualityWindowSize: 50,
  };
}

// ── Tests ─────────────────────────────────────────────────

test('loads valid model-routing.json', () => {
  try {
    writeConfig(validBaseConfig());
    const config = loadConfig();
    assert.ok(config, 'should return a config object');
    assert.equal(config!.enabled, true);
    assert.equal(config!.defaultEndpoint, 'test-local');
    assert.equal(config!.endpoints.length, 1);
    assert.equal(config!.endpoints[0]!.id, 'test-local');
    assert.equal(config!.endpoints[0]!.name, 'opencode-cli / test-model');
    assert.equal(config!.endpoints[0]!.isLocal, true);
    assert.equal(config!.rules.length, 1);
    assert.equal(config!.rules[0]!.id, 'rule-default');
    assert.equal(config!.qualityThreshold, 0.7);
    assert.equal(config!.qualityWindowSize, 50);
  } finally {
    restoreOriginal();
  }
});

test('returns null when file not found', () => {
  try {
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
    const config = loadConfig();
    assert.equal(config, null);
  } finally {
    restoreOriginal();
  }
});

test('returns null when JSON invalid', () => {
  try {
    writeConfig('{ invalid json }');
    const config = loadConfig();
    assert.equal(config, null);
  } finally {
    restoreOriginal();
  }
});

test('returns null when required fields missing', () => {
  const requiredFields = [
    'enabled',
    'endpoints',
    'rules',
    'defaultEndpoint',
    'qualityThreshold',
    'qualityWindowSize',
  ];

  for (const field of requiredFields) {
    try {
      const cfg = validBaseConfig();
      delete cfg[field];
      writeConfig(cfg);
      const config = loadConfig();
      assert.equal(config, null, `missing field "${field}" should return null`);
    } finally {
      restoreOriginal();
    }
  }
});

test('validates costTier values', () => {
  try {
    const cfg = validBaseConfig();
    cfg.endpoints = [
      {
        id: 'bad-tier',
        providerId: 'test',
        model: 'm',
        costTier: 'platinum', // invalid
        capabilities: ['chat'],
        maxTokens: 1000,
      },
      {
        id: 'good-tier',
        providerId: 'test',
        model: 'm',
        costTier: 'cheap', // valid
        capabilities: ['chat'],
        maxTokens: 1000,
      },
    ];
    writeConfig(cfg);
    const config = loadConfig();
    assert.ok(config, 'config should load despite invalid endpoint');
    assert.equal(config!.endpoints.length, 1);
    assert.equal(config!.endpoints[0]!.id, 'good-tier');
  } finally {
    restoreOriginal();
  }
});

test('validates capabilities array', () => {
  try {
    const cfg = validBaseConfig();
    (cfg.endpoints as unknown[])[0] = {
      id: 'bad-caps',
      providerId: 'test',
      model: 'm',
      costTier: 'free',
      capabilities: 'not-an-array', // invalid
      maxTokens: 1000,
    };
    writeConfig(cfg);
    const config = loadConfig();
    assert.ok(config, 'config should load');
    assert.equal(config!.endpoints.length, 0, 'endpoint with non-array capabilities should be filtered out');
  } finally {
    restoreOriginal();
  }
});

test('validates maxTokens positive number', () => {
  const badValues = [0, -1, -100];

  for (const val of badValues) {
    try {
      const cfg = validBaseConfig();
      const endpoints = cfg.endpoints as Record<string, unknown>[];
      const ep = endpoints[0];
      assert.ok(ep);
      ep.maxTokens = val;
      writeConfig(cfg);
      const config = loadConfig();
      assert.ok(config, `config should load despite maxTokens=${val}`);
      assert.equal(config!.endpoints.length, 0, `endpoint with maxTokens=${val} should be filtered out`);
    } finally {
      restoreOriginal();
    }
  }
});

test('handles empty arrays', () => {
  try {
    const cfg = validBaseConfig();
    cfg.endpoints = [];
    cfg.rules = [];
    writeConfig(cfg);
    const config = loadConfig();
    assert.ok(config, 'config with empty arrays should still be valid');
    assert.equal(config!.endpoints.length, 0);
    assert.equal(config!.rules.length, 0);
    assert.equal(config!.enabled, true);
  } finally {
    restoreOriginal();
  }
});

test('config.enabled false vs true', () => {
  for (const enabled of [false, true]) {
    try {
      const cfg = validBaseConfig();
      cfg.enabled = enabled;
      writeConfig(cfg);
      const config = loadConfig();
      assert.ok(config, `should load when enabled=${enabled}`);
      assert.equal(config!.enabled, enabled);
    } finally {
      restoreOriginal();
    }
  }
});
