/**
 * Tests for Claude OAuth token integration.
 *
 * Note: These tests focus on pure functions that don't require mocking
 * file system paths. Integration tests with actual file paths would
 * require environment setup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the functions to test
import {
  isTokenExpiringSoon,
  isTokenExpired,
  type TokenInfo,
} from '../src/vault/claude-oauth.js';

describe('Claude OAuth', () => {
  describe('isTokenExpiringSoon', () => {
    it('returns false when no expiry is set', () => {
      const token: TokenInfo = { accessToken: 'test-token' };
      assert.strictEqual(isTokenExpiringSoon(token), false);
    });

    it('returns true when token expires within 5 minutes', () => {
      const token: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now
      };
      assert.strictEqual(isTokenExpiringSoon(token), true);
    });

    it('returns false when token expires in more than 5 minutes', () => {
      const token: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes from now
      };
      assert.strictEqual(isTokenExpiringSoon(token), false);
    });

    it('returns true when token is already expired', () => {
      const token: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() - 1000, // 1 second ago
      };
      assert.strictEqual(isTokenExpiringSoon(token), true);
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when no expiry is set', () => {
      const token: TokenInfo = { accessToken: 'test-token' };
      assert.strictEqual(isTokenExpired(token), false);
    });

    it('returns false when token is still valid', () => {
      const token: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };
      assert.strictEqual(isTokenExpired(token), false);
    });

    it('returns true when token has expired', () => {
      const token: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() - 1000, // 1 second ago
      };
      assert.strictEqual(isTokenExpired(token), true);
    });
  });
});

describe('Token expiry edge cases', () => {
  it('handles token expiring exactly at the boundary', () => {
    // Token expiring exactly at 5 minutes
    const token: TokenInfo = {
      accessToken: 'test',
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    assert.strictEqual(isTokenExpiringSoon(token), true);
  });

  it('handles token expiring just over the boundary', () => {
    // Token expiring at 5 minutes + 1 second
    const token: TokenInfo = {
      accessToken: 'test',
      expiresAt: Date.now() + 5 * 60 * 1000 + 1000,
    };
    assert.strictEqual(isTokenExpiringSoon(token), false);
  });

  it('handles very short-lived tokens', () => {
    const token: TokenInfo = {
      accessToken: 'test',
      expiresAt: Date.now() + 1000, // 1 second
    };
    assert.strictEqual(isTokenExpiringSoon(token), true);
    assert.strictEqual(isTokenExpired(token), false);
  });
});

describe('TokenInfo type validation', () => {
  it('accepts token with only access token', () => {
    const token: TokenInfo = { accessToken: 'sk-ant-12345' };
    assert.strictEqual(token.accessToken, 'sk-ant-12345');
  });

  it('accepts token with all fields', () => {
    const token: TokenInfo = {
      accessToken: 'sk-ant-12345',
      refreshToken: 'refresh-67890',
      expiresAt: Date.now() + 3600000,
    };
    assert.strictEqual(token.accessToken, 'sk-ant-12345');
    assert.strictEqual(token.refreshToken, 'refresh-67890');
    assert.strictEqual(typeof token.expiresAt, 'number');
  });
});
