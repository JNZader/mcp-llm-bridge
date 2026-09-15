import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';

const [root, marker, scenario] = process.argv.slice(2);
assert.ok(root && marker && scenario);
assert.ok(isAbsolute(root));
assert.ok(basename(root).startsWith('wp00-setup-gateway-'));
assert.equal(process.env['HOME'], root);
assert.equal(homedir(), root);
assert.equal(realpathSync(root), root);
assert.equal(lstatSync(root).isSymbolicLink(), false);
assert.equal(lstatSync(root).isDirectory(), true);
assert.deepEqual(readdirSync(root), ['fixture-marker']);
assert.equal(readFileSync(join(root, 'fixture-marker'), 'utf8'), marker);
const previousCwd = process.cwd();
const project = join(root, 'project');
mkdirSync(project);
process.chdir(project);
// No production import or settings read before canonical synthetic HOME/cwd.
assert.equal(realpathSync(process.cwd()), project);
const { runSetupGateway } = await import('../../../src/setup/gateway-setup.js');
const { DEFAULT_HTTP_PORT } = await import('../../../src/core/constants.js');
const path = join(scenario === 'apply-project' ? project : root, '.claude', 'settings.json');
mkdirSync(dirname(path));
const original = '{"custom":{"keep":true},"env":{"KEEP":"unchanged"}}\n';
const existing = scenario !== 'apply-empty';
if (existing) writeFileSync(path, original, { mode: 0o600 });
const CANARY = 'synthetic-gateway-error-canary';
const TOKEN = 'synthetic-intentional-gateway-token';
const controls = ['default', 'prefix', 'token', 'apply-user', 'apply-project', 'apply-empty'];
const env: NodeJS.ProcessEnv = {};
if (controls.includes(scenario) && scenario !== 'default' && scenario !== 'apply-empty') {
  env['LLM_GATEWAY_AUTH_TOKEN'] = '  ' + TOKEN + '  ';
}
if (scenario === 'prefix') env['LLM_GATEWAY_PORT'] = '4321suffix';
if (scenario === 'port-text') env['LLM_GATEWAY_PORT'] = CANARY;
if (scenario === 'port-zero') env['LLM_GATEWAY_PORT'] = '0';
if (scenario === 'port-high') env['LLM_GATEWAY_PORT'] = '65536';
let inspections = 0;
const inspect = () => { inspections++; throw new Error(CANARY); };
let failure: unknown;
switch (scenario) {
  case 'error': failure = new Error(CANARY); break;
  case 'string': failure = CANARY; break;
  case 'getter': failure = Object.defineProperty({}, 'message', { get: inspect }); break;
  case 'coercion': failure = { message: { toString: inspect, [Symbol.toPrimitive]: inspect } }; break;
  case 'proxy': failure = new Proxy({}, { get: inspect, getPrototypeOf: inspect }); break;
  case 'revoked': {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    failure = revoked.proxy;
    break;
  }
  case 'null': failure = null; break;
  default: assert.ok(controls.includes(scenario) || scenario.startsWith('scope-') || scenario.startsWith('port-'));
}
if (failure !== undefined) {
  // Defensive supplied-environment fault, not a claim about process.env values.
  Object.defineProperty(env, 'LLM_GATEWAY_PORT', { get() { throw failure; } });
}
const argv = scenario === 'scope-separated' ? ['--scope', CANARY]
  : scenario === 'scope-equals' ? ['--scope=' + CANARY]
  : scenario === 'scope-missing' ? ['--scope']
  : scenario === 'apply-project' ? ['--apply', '--scope', 'project']
  : scenario.startsWith('apply-') ? ['--apply'] : [];
const out: string[] = [];
const err: string[] = [];
const streams = [out, err].map((lines) => new Writable({
  write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); },
}));
const [stdout, stderr] = streams;
assert.ok(stdout && stderr);
const realConsole = new Console({ stdout, stderr });
const originalConsole = { log: console.log, error: console.error, warn: console.warn };
try {
  console.log = realConsole.log.bind(realConsole);
  console.error = realConsole.error.bind(realConsole);
  console.warn = realConsole.warn.bind(realConsole);
  let code: number | undefined;
  let escaped = false;
  try { code = await runSetupGateway(argv, { env, settingsPathOverride: path }); }
  catch { escaped = true; }
  const bytes = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const written = bytes !== undefined && bytes !== original;
  const backups = readdirSync(dirname(path)).filter((name) => name.startsWith('settings.json.bak-'));
  if (written) {
    assert.deepEqual(JSON.parse(bytes!), {
      ...(existing ? { custom: { keep: true } } : {}),
      env: {
        ...(existing ? { KEEP: 'unchanged' } : {}),
        ANTHROPIC_BASE_URL: 'http://localhost:' + DEFAULT_HTTP_PORT,
        ...(scenario !== 'apply-empty' ? { ANTHROPIC_AUTH_TOKEN: TOKEN } : {}),
      },
    });
  } else assert.equal(bytes, existing ? original : undefined);
  assert.equal(backups.length, written && existing ? 1 : 0);
  if (backups.length) assert.equal(readFileSync(join(dirname(path), backups[0]!), 'utf8'), original);
  assert.equal(existsSync(join(root, '.llm-gateway')), false);
  assert.equal(existsSync(join(project, 'vault.db')), false);
  assert.equal(existsSync(join(project, 'master.key')), false);
  process.stdout.write(JSON.stringify({ code, escaped, inspections, written, backup: backups.length === 1, out, err }));
} finally {
  Object.assign(console, originalConsole);
  for (const stream of streams) stream.destroy();
  process.chdir(previousCwd);
}
