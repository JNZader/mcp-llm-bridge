import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tryProvider } from '../src/core/router-executor.js';
import { buildGenerateResponseFromInternal } from '../src/core/router-shaping.js';
import { readUsageProvenance } from '../src/core/usage-provenance.js';
import { buildGenerateExecutionResponse, createRouterExecutionContract } from '../src/core/router-execution-contract.js';
import type {
  LLMProvider,
  PartialUsageProvenance,
  ReportedUsageProvenance,
  UnknownUsageProvenance,
} from '../src/core/types.js';
import { cliOutbound } from '../src/transformers/outbound/cli.js';
import {
  executeNonStreamingChatCompletions,
  prepareChatCompletionsRequest,
} from '../src/server/execution/chat-completions-service.js';

const REPORTED = {
  status: 'reported',
  origin: 'cli-output',
  eventCount: 1,
  inputTokens: 0,
  outputTokens: 0,
} as const satisfies ReportedUsageProvenance;

const PARTIAL = {
  status: 'partial',
  origin: 'cli-output',
  eventCount: 1,
  inputTokens: 2,
} as const satisfies PartialUsageProvenance;

const UNKNOWN = { status: 'unknown', reason: 'absent' } as const satisfies UnknownUsageProvenance;

const VALID_PROVENANCE = [REPORTED, PARTIAL, UNKNOWN] as const;

function optionsFor(
  provider: Pick<LLMProvider, 'id' | 'type' | 'generate'>,
  getOutbound: (providerId: string) => unknown,
) {
  return {
    provider: {
      ...provider,
      name: provider.id,
      models: [],
      isAvailable: async () => true,
    },
    request: { messages: [{ role: 'user' as const, content: 'hello' }], model: 'model' },
    registry: { getOutbound } as never,
    circuitBreaker: { recordSuccess: () => {}, recordFailure: () => {} } as never,
    attempt: 1,
    resolveFeedbackEndpointId: () => 'endpoint',
    recordUsage: () => {},
    recordModelFeedback: () => {},
  };
}

describe('usage provenance propagation', () => {
  const contract = () => createRouterExecutionContract({
    routingMetadata: { strategy: 'test' },
  });

  const validToolEvidence = {
    status: 'complete',
    mode: 'none',
    source: 'opencode-json-events',
    toolCallCount: 0,
    enforcement: 'temporary-opencode-agent-config',
    observable: true,
  } as const;

  it('does not expose provider tool evidence without an explicit tools=none request', () => {
    const response = buildGenerateExecutionResponse(contract(), {
      request: { prompt: 'hello' },
      result: {
        text: 'answer', provider: 'opencode-cli', model: 'model', resolvedProvider: 'opencode-cli',
        resolvedModel: 'model', fallbackUsed: false, toolEvidence: validToolEvidence,
      },
      latencyMs: 1,
    });

    assert.equal(Object.hasOwn(response, 'toolEvidence'), false);

    const legacyResponse = buildGenerateResponseFromInternal(
      { prompt: 'hello' },
      {
        content: 'answer', model: 'model', finishReason: 'stop', usage: { totalTokens: 0 },
         metadata: { provider: 'opencode-cli', resolvedProvider: 'opencode-cli', toolEvidence: validToolEvidence },
      },
    );
    assert.equal(Object.hasOwn(legacyResponse, 'toolEvidence'), false);
  });

  it('includes only strict zero-call evidence for an explicit tools=none request', () => {
    const response = buildGenerateExecutionResponse(contract(), {
      request: { prompt: 'hello', tools: 'none' },
      result: {
        text: 'answer', provider: 'opencode-cli', model: 'model', resolvedProvider: 'opencode-cli',
        resolvedModel: 'model', fallbackUsed: false, toolEvidence: validToolEvidence,
      },
      latencyMs: 1,
    });

    assert.deepEqual(response.toolEvidence, validToolEvidence);

    const legacyResponse = buildGenerateResponseFromInternal(
      { prompt: 'hello', tools: 'none' },
      {
        content: 'answer', model: 'model', finishReason: 'stop', usage: { totalTokens: 0 },
        metadata: { provider: 'opencode-cli', resolvedProvider: 'opencode-cli', toolEvidence: validToolEvidence },
      },
    );
    assert.deepEqual(legacyResponse.toolEvidence, validToolEvidence);
  });

  it('fails closed when tools=none evidence is absent, malformed, or reports calls', () => {
    for (const toolEvidence of [
      undefined,
      { ...validToolEvidence, observable: false },
      { ...validToolEvidence, toolCallCount: 1 },
      { ...validToolEvidence, toolCallCount: false },
      { ...validToolEvidence, extra: 'unexpected' },
      { ...validToolEvidence, source: 'provider-claimed' },
      { ...validToolEvidence, enforcement: 'provider-claimed' },
    ]) {
      assert.throws(() => buildGenerateExecutionResponse(contract(), {
        request: { prompt: 'hello', tools: 'none' },
        result: {
          text: 'answer', provider: 'provider', model: 'model', resolvedProvider: 'provider',
          resolvedModel: 'model', fallbackUsed: false, toolEvidence: toolEvidence as never,
        },
        latencyMs: 1,
      }), /requires valid tool evidence/);
    }
  });

  it('projects each valid CLI status and leaves raw CLI strings unchanged', () => {
    for (const provenance of VALID_PROVENANCE) {
      const response = cliOutbound.transformResponse({
        text: 'answer',
        model: 'cli-model',
        usageProvenance: { ...provenance, secretMarker: 'must-not-leak' },
      });

      assert.deepEqual(response.metadata, { usageProvenance: provenance });
      assert.deepEqual(response.usage, {});
    }

    assert.deepEqual(cliOutbound.transformResponse('raw output'), {
      content: 'raw output',
      model: 'cli-unknown',
      finishReason: 'stop',
      usage: {},
    });
    assert.equal(
      cliOutbound.transformResponse({ text: 'answer', usageProvenance: { ...REPORTED, eventCount: 2 } })
        .metadata,
      undefined,
    );
    assert.equal(cliOutbound.transformResponse({ text: 'answer' }).metadata, undefined);
  });

  it('propagates sanitized provenance through actual CLI and ordinary tryProvider branches', async () => {
    const cliResponse = await tryProvider(optionsFor(
      {
        id: 'cli-provider',
        type: 'cli',
        generate: async () => ({
          text: 'cli answer', provider: 'cli-provider', model: 'cli-model',
          resolvedProvider: 'cli-provider', resolvedModel: 'cli-model', fallbackUsed: false,
          usageProvenance: { ...PARTIAL, secretMarker: 'must-not-leak' },
        }),
      },
      (providerId) => (providerId === 'cli' ? cliOutbound : undefined),
    ));
    assert.deepEqual(cliResponse.metadata, { usageProvenance: PARTIAL });

    const ordinaryResponse = await tryProvider(optionsFor(
      {
        id: 'ordinary-provider',
        type: 'api',
        generate: async () => ({
          text: 'ordinary answer', provider: 'ordinary-provider', model: 'ordinary-model',
          resolvedProvider: 'ordinary-provider', resolvedModel: 'ordinary-model', fallbackUsed: false,
          usageProvenance: { ...UNKNOWN, secretMarker: 'must-not-leak' },
        }),
      },
      (providerId) => (providerId === 'ordinary-provider' ? { transformRequest: () => ({}) } : undefined),
    ));
    assert.deepEqual(ordinaryResponse.metadata?.['usageProvenance'], UNKNOWN);
  });

  it('restores only valid provenance in legacy reconstruction', () => {
    for (const provenance of VALID_PROVENANCE) {
      const response = buildGenerateResponseFromInternal(
        { prompt: 'hello' },
        {
          content: 'answer', model: 'model', finishReason: 'stop', usage: { totalTokens: 0 },
          metadata: { provider: 'provider', usageProvenance: { ...provenance, secretMarker: 'must-not-leak' } },
        },
      );
      assert.deepEqual(response.usageProvenance, provenance);
      assert.equal(Object.hasOwn(response, 'usageProvenance'), true);
    }

    const omitted = buildGenerateResponseFromInternal(
      { prompt: 'hello' },
      {
        content: 'answer', model: 'model', finishReason: 'stop', usage: { totalTokens: 0 },
        metadata: { provider: 'provider', usageProvenance: { ...REPORTED, eventCount: 2 } },
      },
    );
    assert.equal(Object.hasOwn(omitted, 'usageProvenance'), false);
  });

  it('exposes valid internal provenance only on non-streaming x_gateway metadata', async () => {
    const prepared = prepareChatCompletionsRequest({
      model: 'model', messages: [{ role: 'user', content: 'hello' }],
    });
    for (const provenance of VALID_PROVENANCE) {
      const response = await executeNonStreamingChatCompletions({
        prepared,
        scope: {},
        now: () => 1_000,
        createChatCompletionId: () => 'chatcmpl-test',
        router: {
          generateFromInternal: async () => ({
            content: 'answer', model: 'model', finishReason: 'stop', usage: {},
            metadata: { provider: 'provider', usageProvenance: { ...provenance, secretMarker: 'must-not-leak' } },
          }),
        } as never,
      }) as { x_gateway: Record<string, unknown> };
      assert.deepEqual(response.x_gateway['usageProvenance'], provenance);
      assert.equal(Object.hasOwn(response, 'usage'), false);
    }

    const omitted = await executeNonStreamingChatCompletions({
      prepared,
      scope: {},
      router: {
        generateFromInternal: async () => ({
          content: 'answer', model: 'model', finishReason: 'stop', usage: {},
          metadata: { provider: 'provider', usageProvenance: null },
        }),
      } as never,
    }) as { x_gateway: Record<string, unknown> };
    assert.equal(Object.hasOwn(omitted.x_gateway, 'usageProvenance'), false);
  });

  it('strictly projects only valid provenance without mutating its input', () => {
    const marked = { ...REPORTED, secretMarker: 'must-not-leak' };
    const original = { ...marked };
    assert.deepEqual(readUsageProvenance(marked), REPORTED);
    assert.deepEqual(marked, original);

    for (const [name, value] of [
      ['invalid origin', { ...REPORTED, origin: 'api-output' }],
      ['invalid event count', { ...REPORTED, eventCount: 2 }],
      ['invalid status', { ...REPORTED, status: 'other' }],
      ['invalid counter', { ...REPORTED, inputTokens: -1 }],
      ['overflowing sum', { ...REPORTED, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }],
      ['malformed partial', { ...PARTIAL, outputTokens: undefined }],
      ['invalid unknown reason', { ...UNKNOWN, reason: 'other' }],
    ] as const) {
      assert.equal(readUsageProvenance(value), undefined, name);
    }
  });
});
