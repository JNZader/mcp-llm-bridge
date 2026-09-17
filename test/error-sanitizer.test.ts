import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { publicErrorMessage, sanitizeError } from '../src/core/error-sanitizer.js';

describe('publicErrorMessage', () => {
  it('redacts bearer and token fields from Error and string failures', () => {
    const fromError = publicErrorMessage(new Error('fail Bearer sk-live-secret token=abc123'));
    const fromString = publicErrorMessage('fail Bearer sk-live-secret token=abc123');

    for (const message of [fromError, fromString]) {
      assert.doesNotMatch(message, /sk-live-secret|abc123/);
      assert.match(message, /Bearer \[REDACTED\]/);
    }

    assert.equal(sanitizeError(new Error('Bearer sk-live-secret')).message.includes('sk-live-secret'), false);
  });
});
