import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SafeError, safeError, toSafeHttpError } from '../../src/core/safe-error.js';
import { safeOperation, safeOperationError } from '../../src/core/safe-operation.js';
import { safeTelemetry } from '../../src/core/safe-telemetry.js';

describe('SAFE-CORE', () => {
  it('projects known operational failures to stable public HTTP responses', () => {
    const response = toSafeHttpError(safeError('NOT_AVAILABLE'));

    assert.deepEqual(response, {
      status: 503,
      body: {
        error: 'The requested operation is not available.',
        code: 'NOT_AVAILABLE',
      },
    });
  });

  it('fails closed without exposing an unknown failure message or cause', () => {
    const response = toSafeHttpError(new Error('credential-canary: secret-value'));

    assert.deepEqual(response, {
      status: 500,
      body: {
        error: 'An unexpected internal error occurred.',
        code: 'INTERNAL_ERROR',
      },
    });
    assert.equal(JSON.stringify(response).includes('credential-canary'), false);
  });

  it('maps safe operation outcomes to non-sensitive errors', () => {
    const operation = safeOperation('denied');
    const error = safeOperationError(operation);

    assert.equal(operation.code, 'ACCESS_DENIED');
    assert.ok(error instanceof SafeError);
    assert.equal(toSafeHttpError(error).status, 403);
  });

  it('persists only explicit metadata and omits request content', () => {
    const telemetry = safeTelemetry({
      event: 'request.complete',
      operation: 'generate',
      outcome: 'failed',
      code: 'INTERNAL_ERROR',
      durationMs: 42,
    });

    assert.deepEqual(telemetry, {
      event: 'request.complete',
      operation: 'generate',
      outcome: 'failed',
      code: 'INTERNAL_ERROR',
      durationMs: 42,
    });
    assert.equal('prompt' in telemetry, false);
    assert.equal('response' in telemetry, false);
    assert.equal('credential' in telemetry, false);
  });
});
