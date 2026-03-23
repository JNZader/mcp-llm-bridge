/**
 * Tests for the transformer registry integration.
 *
 * Verifies all transformers are registered correctly and
 * format detection works with the full registry.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the barrel to trigger registration
import { registry } from '../../src/transformers/index.js';

// ── Inbound registration ────────────────────────────────────

describe('TransformerRegistry — inbound formats', () => {
  it('has all 3 inbound formats registered', () => {
    const formats = registry.inboundFormats;
    assert.ok(formats.includes('openai-chat'), 'missing openai-chat');
    assert.ok(formats.includes('openai-responses'), 'missing openai-responses');
    assert.ok(formats.includes('anthropic'), 'missing anthropic');
  });

  it('detects OpenAI Chat format', () => {
    const result = registry.detectInbound({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result?.name, 'openai-chat');
  });

  it('detects OpenAI Responses format', () => {
    const result = registry.detectInbound({
      model: 'gpt-4o',
      input: 'hello',
    });
    assert.equal(result?.name, 'openai-responses');
  });

  it('detects Anthropic Messages format', () => {
    const result = registry.detectInbound({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result?.name, 'anthropic');
  });

  it('returns null for unknown format', () => {
    const result = registry.detectInbound({ unknown: 'format' });
    assert.equal(result, null);
  });

  it('differentiates Anthropic (with max_tokens) from OpenAI Chat (without)', () => {
    // With max_tokens → Anthropic
    const anthropic = registry.detectInbound({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1024,
    });
    assert.equal(anthropic?.name, 'anthropic');

    // Without max_tokens → OpenAI Chat
    const openai = registry.detectInbound({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(openai?.name, 'openai-chat');
  });
});

// ── Outbound registration ───────────────────────────────────

describe('TransformerRegistry — outbound providers', () => {
  it('has all 5 outbound providers registered', () => {
    const providers = registry.outboundProviders;
    assert.ok(providers.includes('openai'), 'missing openai');
    assert.ok(providers.includes('anthropic'), 'missing anthropic');
    assert.ok(providers.includes('google'), 'missing google');
    assert.ok(providers.includes('groq'), 'missing groq');
    assert.ok(providers.includes('openrouter'), 'missing openrouter');
  });

  it('returns openai outbound transformer for "openai"', () => {
    const t = registry.getOutbound('openai');
    assert.ok(t);
    assert.equal(t.name, 'openai');
  });

  it('returns anthropic outbound transformer for "anthropic"', () => {
    const t = registry.getOutbound('anthropic');
    assert.ok(t);
    assert.equal(t.name, 'anthropic');
  });

  it('returns google outbound transformer for "google"', () => {
    const t = registry.getOutbound('google');
    assert.ok(t);
    assert.equal(t.name, 'google');
  });

  it('groq and openrouter share the openai outbound transformer', () => {
    const groq = registry.getOutbound('groq');
    const openrouter = registry.getOutbound('openrouter');
    const openai = registry.getOutbound('openai');

    // They should be the exact same object reference
    assert.equal(groq, openai);
    assert.equal(openrouter, openai);
  });

  it('returns null for unknown provider', () => {
    assert.equal(registry.getOutbound('unknown-provider'), null);
  });
});

// ── Round-trip sanity ───────────────────────────────────────

describe('TransformerRegistry — round-trip sanity', () => {
  it('OpenAI Chat inbound → OpenAI outbound produces valid body', () => {
    // Note: no max_tokens here — when max_tokens is present with messages,
    // the Anthropic detector matches first (max_tokens is required in Anthropic).
    // In practice, clients use the correct format for their target provider.
    const raw = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      temperature: 0.7,
    };

    const inbound = registry.detectInbound(raw);
    assert.ok(inbound);
    assert.equal(inbound.name, 'openai-chat');
    const internal = inbound.transformRequest(raw);

    const outbound = registry.getOutbound('openai');
    assert.ok(outbound);
    const body = outbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(body['model'], 'gpt-4o');
    assert.equal(body['temperature'], 0.7);
    assert.ok(Array.isArray(body['messages']));
  });

  it('Anthropic inbound → Anthropic outbound produces valid body', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const inbound = registry.detectInbound(raw);
    assert.ok(inbound);
    const internal = inbound.transformRequest(raw);

    const outbound = registry.getOutbound('anthropic');
    assert.ok(outbound);
    const body = outbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(body['model'], 'claude-sonnet-4-20250514');
    assert.equal(body['max_tokens'], 1024);
    assert.equal(body['system'], 'Be concise.');
    assert.ok(Array.isArray(body['messages']));
  });

  it('OpenAI Chat inbound → Anthropic outbound (cross-format)', () => {
    const raw = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const inbound = registry.detectInbound(raw);
    assert.ok(inbound);
    const internal = inbound.transformRequest(raw);

    const outbound = registry.getOutbound('anthropic');
    assert.ok(outbound);
    const body = outbound.transformRequest(internal) as Record<string, unknown>;

    // System should be extracted to top level
    assert.equal(body['system'], 'Be helpful.');
    // Messages should only have the user message
    const messages = body['messages'] as Record<string, unknown>[];
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.['role'], 'user');
  });
});
