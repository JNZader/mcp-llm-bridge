import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGenerateExecutionResponse,
  buildInternalResolutionMetadataOptions,
  buildStreamingExecutionResponseData,
  createRouterExecutionContract,
} from '../../src/core/router-execution-contract.js';
import { withInternalResolutionMetadata } from '../../src/core/router-shaping.js';

describe('router execution contract', () => {
  it('keeps attempted providers and fallback metadata aligned across internal and streaming consumers', () => {
    const execution = createRouterExecutionContract({
      requestedModel: 'cloud-model',
      routingMetadata: {
        strategy: 'local-offload',
        classification: {
          task: 'summarization',
          confidence: 0.75,
          shouldOffload: true,
          reason: 'Matched 1 keyword(s) for summarization',
        },
        decisionReason: 'Matched 1 keyword(s) for summarization',
      },
    });

    execution.recordAttempt('local-llm');
    execution.recordAttempt('cloud');

    const internal = withInternalResolutionMetadata(
      {
        content: 'done',
        model: 'cloud-model',
        finishReason: 'stop',
        usage: { totalTokens: 7 },
        metadata: {},
      },
      buildInternalResolutionMetadataOptions(execution, {
        resolvedProvider: 'cloud',
        resolvedModel: 'cloud-model',
      }),
    );
    const streaming = buildStreamingExecutionResponseData(execution, {
      providerId: 'cloud',
      resolvedModel: 'cloud-model',
    });

    assert.deepEqual(internal.metadata?.['attemptedProviders'], ['local-llm', 'cloud']);
    assert.equal(internal.metadata?.['fallbackUsed'], true);
    assert.deepEqual(internal.metadata?.['routing'], streaming.routing);
    assert.deepEqual(streaming.routing, {
      strategy: 'local-offload',
      classification: {
        task: 'summarization',
        confidence: 0.75,
        shouldOffload: true,
        reason: 'Matched 1 keyword(s) for summarization',
      },
      attemptedProviders: ['local-llm', 'cloud'],
      fallbackFrom: 'local-llm',
      fallbackTo: 'cloud',
      decisionReason: 'Matched 1 keyword(s) for summarization',
    });
  });

  it('shapes generate responses from the same fallback snapshot logic', () => {
    const execution = createRouterExecutionContract({
      requestedModel: 'cloud-model',
      routingMetadata: {
        strategy: 'local-offload',
        classification: {
          task: 'summarization',
          confidence: 0.75,
          shouldOffload: true,
          reason: 'Matched 1 keyword(s) for summarization',
        },
        decisionReason: 'Matched 1 keyword(s) for summarization',
      },
    });

    execution.recordAttempt('local-llm');
    execution.recordAttempt('cloud');

    const response = buildGenerateExecutionResponse(execution, {
      request: {
        prompt: 'summarize this',
        model: 'cloud-model',
      },
      result: {
        text: 'done',
        provider: 'cloud',
        model: 'cloud-model',
        resolvedProvider: 'cloud',
        resolvedModel: 'cloud-model',
        fallbackUsed: false,
      },
      latencyMs: 42,
    });

    assert.equal(response.fallbackUsed, true);
    assert.equal(response.requestedModel, 'cloud-model');
    assert.equal(response.resolvedProvider, 'cloud');
    assert.equal(response.resolvedModel, 'cloud-model');
    assert.equal(response.latencyMs, 42);
    assert.deepEqual(response.routing, {
      strategy: 'local-offload',
      classification: {
        task: 'summarization',
        confidence: 0.75,
        shouldOffload: true,
        reason: 'Matched 1 keyword(s) for summarization',
      },
      attemptedProviders: ['local-llm', 'cloud'],
      fallbackFrom: 'local-llm',
      fallbackTo: 'cloud',
      decisionReason: 'Matched 1 keyword(s) for summarization',
    });
  });
});
