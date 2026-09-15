import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAuthRuntime, AUTH_UNAVAILABLE_REASON, type AdminCredentialMode, type CredentialHeaders } from '../../src/auth/runtime.js';
import { loadConfig } from '../../src/core/config.js';
import { MIN_AUTH_TOKEN_LENGTH } from '../../src/core/constants.js';

const token = 't'.repeat(MIN_AUTH_TOKEN_LENGTH);
const oauth = { clientId: 'client-id', clientSecret: 'client-secret', allowedUsers: ['octocat'] };

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
    run();
  } finally {
    for (const [key, value] of before) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

describe('AUTH-RUNTIME', () => {
  it('default-denies absent, weak, incomplete, and empty-allowlist configuration', () => {
    const absent = createAuthRuntime({});
    assert.deepEqual(absent.publicView, { admin: { available: false, modes: [] }, githubOAuth: { available: false } });
    assert.deepEqual(absent.authenticateStatic('any-token'), { authorized: false, reason: AUTH_UNAVAILABLE_REASON.NOT_CONFIGURED });

    const weak = createAuthRuntime({ staticToken: 'x' });
    assert.deepEqual(weak.publicView.admin, { available: false, modes: [] });
    assert.deepEqual(weak.authenticateStatic('x'), { authorized: false, reason: AUTH_UNAVAILABLE_REASON.NOT_CONFIGURED });

    for (const githubOAuth of [
      { clientId: 'id', clientSecret: '', allowedUsers: ['octocat'] },
      { clientId: 'id', clientSecret: 'secret', allowedUsers: [] },
    ]) {
      const runtime = createAuthRuntime({ githubOAuth });
      assert.equal(runtime.publicView.githubOAuth.available, false);
      assert.deepEqual(runtime.authorizeGithubUser('octocat'), { authorized: false, reason: AUTH_UNAVAILABLE_REASON.OAUTH_NOT_CONFIGURED });
    }
  });

  it('selects cookie first and parses only valid case-insensitive Bearer credentials', () => {
    const runtime = createAuthRuntime({ staticToken: token, githubOAuth: oauth });
    const credentials: ReadonlyArray<readonly [CredentialHeaders, AdminCredentialMode]> = [
      [{ cookie: 'llm_gateway_admin=session', authorization: `bearer ${token}` }, { kind: 'cookie', encodedSession: 'session' }],
      [{ authorization: `Bearer ${token}` }, { kind: 'bearer', token }],
      [{ authorization: `bearer   ${token}` }, { kind: 'bearer', token }],
      [{ authorization: `BEARER\t${token}` }, { kind: 'bearer', token }],
      [{ authorization: 'Basic value' }, { kind: 'none' }],
      [{ authorization: 'Bearer' }, { kind: 'none' }],
      [{ authorization: 'Bearer ' }, { kind: 'none' }],
      [{ authorization: 'Bearer\ttoken extra' }, { kind: 'none' }],
      [{}, { kind: 'none' }],
    ];
    for (const [headers, expected] of credentials) assert.deepEqual(runtime.selectCredential(headers), expected);
  });

  it('keeps public views secret-free and validates runtime/config authorization', () => {
    const runtime = createAuthRuntime({ staticToken: token, githubOAuth: oauth });
    assert.deepEqual(runtime.publicView, { admin: { available: true, modes: ['static', 'github_oauth'] }, githubOAuth: { available: true } });
    for (const secret of [token, oauth.clientId, oauth.clientSecret]) assert.equal(JSON.stringify(runtime.publicView).includes(secret), false);
    assert.deepEqual(runtime.authenticateStatic(token), { authorized: true });
    assert.deepEqual(runtime.authenticateStatic('wrong-token'), { authorized: false, reason: AUTH_UNAVAILABLE_REASON.INVALID_STATIC_TOKEN });
    assert.deepEqual(runtime.authorizeGithubUser('octocat'), { authorized: true });
    assert.deepEqual(runtime.authorizeGithubUser('mallory'), { authorized: false, reason: AUTH_UNAVAILABLE_REASON.OAUTH_USER_DENIED });

    withEnv({
      LLM_GATEWAY_MASTER_KEY: 'a'.repeat(64), LLM_GATEWAY_DB_PATH: '/tmp/wp00-auth-runtime.sqlite',
      LLM_GATEWAY_AUTH_TOKEN: token, ADMIN_TOKEN: 'a'.repeat(MIN_AUTH_TOKEN_LENGTH), NODE_ENV: 'test',
    }, () => {
      assert.equal(loadConfig().adminAuth?.staticToken, 'a'.repeat(MIN_AUTH_TOKEN_LENGTH));
      process.env.ADMIN_TOKEN = 'short';
      assert.throws(loadConfig, /ADMIN_TOKEN must be at least/);
    });
  });
});
