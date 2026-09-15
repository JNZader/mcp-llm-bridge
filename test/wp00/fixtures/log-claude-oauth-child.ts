import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';
import type { TokenInfo } from '../../../src/vault/claude-oauth.js';

const [root, marker, scenario] = process.argv.slice(2);
assert.ok(root && marker && scenario);
assert.ok(isAbsolute(root));
assert.ok(basename(root).startsWith('wp00-oauth-canary-'));
assert.equal(process.env['HOME'], root);
assert.equal(homedir(), root);
assert.equal(realpathSync(root), root);
assert.equal(lstatSync(root).isSymbolicLink(), false);
assert.equal(lstatSync(root).isDirectory(), true);
assert.deepEqual(readdirSync(root), ['fixture-marker']);
assert.equal(readFileSync(join(root, 'fixture-marker'), 'utf8'), marker);
// No production imports until the fresh, parent-owned HOME has been checked.
// No credential-reader function is ever invoked by this fixture.
process.umask(0o022);
const { syncToOpencodeAuth } = await import('../../../src/vault/claude-oauth.js');
const { createLogger, logger } = await import('../../../src/core/logger.js');
const CANARY = 'synthetic-oauth-private-canary';
const authPath = join(root, '.local', 'share', 'opencode', 'auth.json');
const raw: string[] = [];
const output: string[] = [];
const stream = new Writable({
  write(chunk, _encoding, done) { raw.push(chunk.toString()); done(); },
});
const realConsole = new Console({ stdout: stream, stderr: stream });
const pino = createLogger({ pretty: false, level: 'trace' }, {
  write(line: string) { output.push(line); },
});
const originalError = console.error;
const originalLoggerError = logger.error;
console.error = realConsole.error.bind(realConsole);
logger.error = pino.error.bind(pino);
let inspections = 0;
const inspect = () => { inspections++; throw new Error(CANARY); };
let result: boolean | undefined;
let escaped = false;
let written: Record<string, unknown> | null = null;
try {
  const token: TokenInfo = { accessToken: CANARY };
  if (scenario === 'full') {
    token.refreshToken = 'synthetic-refresh-canary';
    token.expiresAt = 1900000000000;
  } else if (scenario === 'filesystem') {
    mkdirSync(authPath, { recursive: true, mode: 0o700 });
  } else if (scenario !== 'minimal') {
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
      default: throw new Error('Unknown fixture scenario');
    }
    Object.defineProperty(token, 'accessToken', { get() { throw failure; } });
  }
  try { result = syncToOpencodeAuth(token, 'synthetic-project-canary'); }
  catch { escaped = true; }
  if (result === true) {
    assert.equal(realpathSync(authPath), authPath);
    assert.equal(lstatSync(authPath).isSymbolicLink(), false);
    written = JSON.parse(readFileSync(authPath, 'utf8'));
  }
  const directoryMode = statSync(dirname(authPath)).mode & 0o777;
  process.stdout.write(JSON.stringify({ result, escaped, inspections, written, directoryMode, raw, output }));
} finally {
  console.error = originalError;
  logger.error = originalLoggerError;
  stream.destroy();
}
