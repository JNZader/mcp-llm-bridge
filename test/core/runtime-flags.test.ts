import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  approvalFlowsEnabled,
  autoDiscoverModelsEnabled,
  circuitBreakerEnabled,
  freeModelCatalogEnabled,
  latencyRoutingEnabled,
  localLLMEnabled,
  modelRoutingEnabled,
  optimizeMessagesEnabled,
  outputCompressionEnabled,
  useTransformers,
} from '../../src/core/runtime-flags.js';

const FLAG_KEYS = [
  'APPROVAL_FLOWS_ENABLED',
  'AUTO_DISCOVER_MODELS',
  'ENABLE_OUTPUT_COMPRESSION',
  'FREE_MODEL_CATALOG',
  'LATENCY_ROUTING',
  'LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED',
  'LOCAL_LLM_ENABLED',
  'MODEL_ROUTING_ENABLED',
  'OPTIMIZE_MESSAGES_ENABLED',
  'USE_TRANSFORMERS',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  FLAG_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of FLAG_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
});

describe('runtime feature flags', () => {
  it('uses the documented defaults', () => {
    for (const key of FLAG_KEYS) {
      delete process.env[key];
    }

    assert.equal(useTransformers(), false);
    assert.equal(optimizeMessagesEnabled(), true);
    assert.equal(outputCompressionEnabled(), true);
    assert.equal(approvalFlowsEnabled(), true);
    assert.equal(circuitBreakerEnabled(), true);
    assert.equal(modelRoutingEnabled(), false);
    assert.equal(latencyRoutingEnabled(), false);
    assert.equal(freeModelCatalogEnabled(), false);
    assert.equal(localLLMEnabled(), false);
    assert.equal(autoDiscoverModelsEnabled(), false);
  });

  it('reads env mutations at call time after import', () => {
    delete process.env['USE_TRANSFORMERS'];
    delete process.env['OPTIMIZE_MESSAGES_ENABLED'];
    delete process.env['ENABLE_OUTPUT_COMPRESSION'];
    delete process.env['APPROVAL_FLOWS_ENABLED'];
    delete process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
    delete process.env['MODEL_ROUTING_ENABLED'];
    delete process.env['LATENCY_ROUTING'];
    delete process.env['FREE_MODEL_CATALOG'];
    delete process.env['LOCAL_LLM_ENABLED'];
    delete process.env['AUTO_DISCOVER_MODELS'];

    assert.equal(useTransformers(), false);
    assert.equal(optimizeMessagesEnabled(), true);
    assert.equal(outputCompressionEnabled(), true);
    assert.equal(approvalFlowsEnabled(), true);
    assert.equal(circuitBreakerEnabled(), true);
    assert.equal(modelRoutingEnabled(), false);
    assert.equal(latencyRoutingEnabled(), false);
    assert.equal(freeModelCatalogEnabled(), false);
    assert.equal(localLLMEnabled(), false);
    assert.equal(autoDiscoverModelsEnabled(), false);

    process.env['USE_TRANSFORMERS'] = 'true';
    process.env['OPTIMIZE_MESSAGES_ENABLED'] = 'false';
    process.env['ENABLE_OUTPUT_COMPRESSION'] = 'false';
    process.env['APPROVAL_FLOWS_ENABLED'] = 'false';
    process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = 'false';
    process.env['MODEL_ROUTING_ENABLED'] = 'true';
    process.env['LATENCY_ROUTING'] = 'true';
    process.env['FREE_MODEL_CATALOG'] = 'true';
    process.env['LOCAL_LLM_ENABLED'] = 'true';
    process.env['AUTO_DISCOVER_MODELS'] = 'true';

    assert.equal(useTransformers(), true);
    assert.equal(optimizeMessagesEnabled(), false);
    assert.equal(outputCompressionEnabled(), false);
    assert.equal(approvalFlowsEnabled(), false);
    assert.equal(circuitBreakerEnabled(), false);
    assert.equal(modelRoutingEnabled(), true);
    assert.equal(latencyRoutingEnabled(), true);
    assert.equal(freeModelCatalogEnabled(), true);
    assert.equal(localLLMEnabled(), true);
    assert.equal(autoDiscoverModelsEnabled(), true);
  });
});
