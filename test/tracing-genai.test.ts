/**
 * OTel GenAI span enrichment tests.
 *
 * Verifies that enrichGenerateSpan() and enrichGenerateSpanFromUsage()
 * correctly set gen_ai.* semantic convention attributes on spans.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichGenerateSpan,
  enrichGenerateSpanFromUsage,
  type GenAISpanAttributes,
} from '../src/core/tracing.js';
import type { Span } from '@opentelemetry/api';

/**
 * Create a mock Span that records setAttribute calls.
 * Returns the mock and the captured attributes map.
 */
function createMockSpan(): { span: Span; attributes: Map<string, unknown> } {
  const attributes = new Map<string, unknown>();

  const span = {
    setAttribute(key: string, value: unknown) {
      attributes.set(key, value);
      return span;
    },
    // Stubs for Span interface — not exercised by enrichGenerateSpan
    setAttributes: () => span,
    addEvent: () => span,
    addLink: () => span,
    setStatus: () => span,
    updateName: () => span,
    end: () => {},
    isRecording: () => true,
    recordException: () => {},
    spanContext: () => ({
      traceId: '0'.repeat(32),
      spanId: '0'.repeat(16),
      traceFlags: 0,
    }),
  } as unknown as Span;

  return { span, attributes };
}

describe('enrichGenerateSpan', () => {
  it('sets all gen_ai.* attributes on the span', () => {
    const { span, attributes } = createMockSpan();

    const attrs: GenAISpanAttributes = {
      'gen_ai.system': 'openai',
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 50,
      'gen_ai.usage.cost': 0.00075,
      'gen_ai.response.finish_reason': 'stop',
    };

    enrichGenerateSpan(span, attrs);

    assert.equal(attributes.get('gen_ai.system'), 'openai');
    assert.equal(attributes.get('gen_ai.request.model'), 'gpt-4o');
    assert.equal(attributes.get('gen_ai.usage.input_tokens'), 100);
    assert.equal(attributes.get('gen_ai.usage.output_tokens'), 50);
    assert.equal(attributes.get('gen_ai.usage.cost'), 0.00075);
    assert.equal(attributes.get('gen_ai.response.finish_reason'), 'stop');
  });

  it('sets cost=0 when explicitly passed', () => {
    const { span, attributes } = createMockSpan();

    enrichGenerateSpan(span, {
      'gen_ai.system': 'custom',
      'gen_ai.request.model': 'unknown-model',
      'gen_ai.usage.input_tokens': 500,
      'gen_ai.usage.output_tokens': 200,
      'gen_ai.usage.cost': 0,
      'gen_ai.response.finish_reason': 'stop',
    });

    assert.equal(attributes.get('gen_ai.usage.cost'), 0);
  });

  it('sets finish_reason=error for failed generations', () => {
    const { span, attributes } = createMockSpan();

    enrichGenerateSpan(span, {
      'gen_ai.system': 'anthropic',
      'gen_ai.request.model': 'claude-3.5-sonnet',
      'gen_ai.usage.input_tokens': 0,
      'gen_ai.usage.output_tokens': 0,
      'gen_ai.usage.cost': 0,
      'gen_ai.response.finish_reason': 'error',
    });

    assert.equal(attributes.get('gen_ai.response.finish_reason'), 'error');
  });
});

describe('enrichGenerateSpanFromUsage', () => {
  it('computes cost from model and token counts for known model', () => {
    const { span, attributes } = createMockSpan();

    // gpt-4o: $2.50/M input, $10.00/M output
    enrichGenerateSpanFromUsage(span, 'openai', 'gpt-4o', 1000, 500, true);

    assert.equal(attributes.get('gen_ai.system'), 'openai');
    assert.equal(attributes.get('gen_ai.request.model'), 'gpt-4o');
    assert.equal(attributes.get('gen_ai.usage.input_tokens'), 1000);
    assert.equal(attributes.get('gen_ai.usage.output_tokens'), 500);

    // Expected: (1000/1M)*2.50 + (500/1M)*10.00 = 0.0025 + 0.005 = 0.0075
    const cost = attributes.get('gen_ai.usage.cost') as number;
    assert.ok(Math.abs(cost - 0.0075) < 1e-10, `expected ~0.0075, got ${cost}`);
    assert.equal(attributes.get('gen_ai.response.finish_reason'), 'stop');
  });

  it('sets cost=0 for unknown model (does not throw)', () => {
    const { span, attributes } = createMockSpan();

    // Unknown model — calculateCost returns 0 with a warning
    enrichGenerateSpanFromUsage(span, 'custom-provider', 'nonexistent-model-xyz', 500, 200, true);

    assert.equal(attributes.get('gen_ai.usage.cost'), 0);
    assert.equal(attributes.get('gen_ai.system'), 'custom-provider');
    assert.equal(attributes.get('gen_ai.request.model'), 'nonexistent-model-xyz');
  });

  it('maps success=true to finish_reason=stop', () => {
    const { span, attributes } = createMockSpan();

    enrichGenerateSpanFromUsage(span, 'openai', 'gpt-4o', 100, 50, true);

    assert.equal(attributes.get('gen_ai.response.finish_reason'), 'stop');
  });

  it('maps success=false to finish_reason=error', () => {
    const { span, attributes } = createMockSpan();

    enrichGenerateSpanFromUsage(span, 'anthropic', 'claude-3.5-sonnet', 0, 0, false);

    assert.equal(attributes.get('gen_ai.response.finish_reason'), 'error');
  });

  it('handles zero tokens correctly', () => {
    const { span, attributes } = createMockSpan();

    enrichGenerateSpanFromUsage(span, 'openai', 'gpt-4o', 0, 0, true);

    assert.equal(attributes.get('gen_ai.usage.input_tokens'), 0);
    assert.equal(attributes.get('gen_ai.usage.output_tokens'), 0);
    assert.equal(attributes.get('gen_ai.usage.cost'), 0);
  });
});
