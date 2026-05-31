import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getTracingOtlpEndpoint,
  isTracingEnabled,
} from '../../src/core/tracing-config.js';

describe('tracing config helpers', () => {
  it('enables tracing only for the explicit true flag', () => {
    assert.equal(isTracingEnabled({ LLM_GATEWAY_TRACING_ENABLED: 'true' }), true);
    assert.equal(isTracingEnabled({ LLM_GATEWAY_TRACING_ENABLED: 'false' }), false);
    assert.equal(isTracingEnabled({}), false);
  });

  it('keeps the configured endpoint and otherwise uses the existing default', () => {
    assert.equal(
      getTracingOtlpEndpoint({ LLM_GATEWAY_OTLP_ENDPOINT: 'http://collector:4318/v1/traces' }),
      'http://collector:4318/v1/traces',
    );
    assert.equal(getTracingOtlpEndpoint({}), 'http://localhost:4318/v1/traces');
  });
});
