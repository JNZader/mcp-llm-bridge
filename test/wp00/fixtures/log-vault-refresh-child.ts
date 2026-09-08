import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';
import type { TokenInfo } from '../../../src/vault/claude-oauth.js';

const [root, marker, scenario] = process.argv.slice(2);
assert.ok(root && marker && scenario);
assert.ok(isAbsolute(root));
assert.ok(basename(root).startsWith('wp00-vault-refresh-'));
assert.equal(process.env['HOME'], root);
assert.equal(homedir(), root);
assert.equal(realpathSync(root), root);
assert.equal(lstatSync(root).isSymbolicLink(), false);
assert.equal(lstatSync(root).isDirectory(), true);
assert.deepEqual(readdirSync(root), ['fixture-marker']);
assert.equal(readFileSync(join(root, 'fixture-marker'), 'utf8'), marker);
// All production imports and synthetic credential creation follow the HOME guard.
const { Vault } = await import('../../../src/vault/vault.js');
const { createLogger, logger } = await import('../../../src/core/logger.js');
const CANARY = 'synthetic-vault-private-canary';
const REFRESH_WARNING = '[claude-oauth] Token refresh not yet implemented. Consider re-authenticating with Claude CLI.';
const sourcePath = join(root, '.claude', '.credentials.json');
const targetPath = join(root, '.local', 'share', 'opencode', 'auth.json');
const token: TokenInfo = {
  accessToken: CANARY,
  refreshToken: scenario === 'no-refresh' ? undefined : CANARY + '-refresh',
  expiresAt: scenario === 'fresh' ? Date.now() + 3600000 : 1,
};
const sourceBytes = JSON.stringify({
  access_token: token.accessToken, refresh_token: token.refreshToken, expires_at: token.expiresAt,
});
if (scenario !== 'missing') {
  mkdirSync(join(root, '.claude'), { mode: 0o700 });
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });
}
const initialEntries = readdirSync(root).sort();
const masterKey = Buffer.alloc(32, 7);
const vault = new Vault({ dbPath: ':memory:', masterKey, httpPort: 0 });
const raw: string[] = [];
const output: string[] = [];
const stream = new Writable({
  write(chunk, _encoding, done) { raw.push(chunk.toString()); done(); },
});
const realConsole = new Console({ stdout: stream, stderr: stream });
const pino = createLogger({ pretty: false, level: 'trace' }, {
  write(line: string) { output.push(line); },
});
let inspections = 0;
let injected = 0;
let escaped = false;
let result: TokenInfo | null | undefined;
const inspect = () => { inspections++; throw new Error(CANARY); };
const originalWarn = console.warn;
const originalLoggerWarn = logger.warn;
try {
  assert.deepEqual(readdirSync(root).sort(), initialEntries);
  assert.equal(vault.getDb().name, ':memory:');
  let failure: unknown;
  switch (scenario) {
    case 'error': failure = new Error(CANARY); break;
    case 'string': failure = CANARY; break;
    case 'getter': failure = Object.defineProperty({}, 'message', { get: inspect }); break;
    case 'coercion': failure = { toString: inspect, [Symbol.toPrimitive]: inspect }; break;
    case 'proxy': failure = new Proxy({}, { get: inspect, getPrototypeOf: inspect }); break;
    case 'revoked': {
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      failure = revoked.proxy;
      break;
    }
    default: assert.ok(['missing', 'no-refresh', 'fresh', 'stub'].includes(scenario));
  }
  console.warn = (...args: unknown[]) => {
    // Defensive internal logger fault, not an implemented remote refresh failure.
    if (args[0] === REFRESH_WARNING && failure !== undefined) {
      injected++;
      throw failure;
    }
    realConsole.warn(...args);
  };
  logger.warn = pino.warn.bind(pino);
  try { result = await vault.getClaudeOAuthToken('synthetic-project-canary'); }
  catch { escaped = true; }
  assert.equal(scenario === 'missing' ? !existsSync(sourcePath) : readFileSync(sourcePath, 'utf8') === sourceBytes, true);
  const preserved = JSON.stringify(result) === JSON.stringify(scenario === 'missing' ? null : token);
  const synced = existsSync(targetPath);
  if (synced) {
    assert.equal(realpathSync(targetPath), targetPath);
    assert.equal(lstatSync(targetPath).isSymbolicLink(), false);
    const written: Record<string, unknown> = JSON.parse(readFileSync(targetPath, 'utf8'));
    assert.equal(typeof written.updated_at, 'string');
    assert.deepEqual(written, {
      access_token: token.accessToken, provider: 'claude-cli', updated_at: written.updated_at,
      expires_at: token.expiresAt,
      ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
    });
  }
  vault.destroy();
  assert.equal(masterKey.every((byte) => byte === 0), true);
  process.stdout.write(JSON.stringify({ escaped, inspections, injected, preserved, synced, destroyed: vault.destroyed, raw, output }));
} finally {
  console.warn = originalWarn;
  logger.warn = originalLoggerWarn;
  if (!vault.destroyed) vault.destroy();
  stream.destroy();
}
