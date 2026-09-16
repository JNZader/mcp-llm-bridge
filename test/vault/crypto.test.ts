import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { decrypt, encrypt } from '../../src/vault/crypto.js';

describe('vault crypto authentication tags', () => {
  it('configures AES-256-GCM to produce a 16-byte authentication tag', () => {
    const encrypted = encrypt('secret', randomBytes(32));

    assert.equal(encrypted.authTag.length, 16);
  });

  it('rejects an authentication tag whose length is not 16 bytes', () => {
    const masterKey = randomBytes(32);
    const encrypted = encrypt('secret', masterKey);

    assert.throws(
      () => decrypt({ ...encrypted, authTag: encrypted.authTag.subarray(0, 15) }, masterKey),
      /authentication tag must be exactly 16 bytes/,
    );
  });
});
