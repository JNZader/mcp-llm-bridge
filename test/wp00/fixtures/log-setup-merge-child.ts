import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { Console } from 'node:console';
import { syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const [root, marker, kind, scenario] = process.argv.slice(2);
assert.ok(root && marker && kind && scenario);
assert.ok(isAbsolute(root));
assert.ok(basename(root).startsWith('wp00-setup-merge-'));
assert.equal(process.env['HOME'], root);
assert.equal(homedir(), root);
assert.equal(fs.realpathSync(root), root);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.lstatSync(root).isDirectory(), true);
assert.deepEqual(fs.readdirSync(root), ['fixture-marker']);
assert.equal(fs.readFileSync(join(root, 'fixture-marker'), 'utf8'), marker);
assert.ok(kind === 'claude' || kind === 'gateway');
const importedGateway = scenario === 'removed-cwd'
  ? await import('../../../src/setup/gateway-setup.js')
  : undefined;
const cwd = process.cwd();
const project = join(root, 'project');
fs.mkdirSync(join(project, 'dist'), { recursive: true });
process.chdir(project);
assert.equal(fs.realpathSync(process.cwd()), project);
fs.writeFileSync(join(project, 'dist', 'index.js'), 'throw new Error("Do not execute fixture");\n');
const target = scenario === 'missing-parent' ? join(root, 'missing', 'config.json') : join(root, 'config.json');
const helperTarget = join(root, 'helper.json');
const original = '{"custom":{"keep":true},"env":{"KEEP":"value"},"mcpServers":{"other":{"command":"unchanged"}}}\n';
const tick = 1900000000000;
const backup = target + '.bak-' + tick;
if (scenario === 'directory' || scenario === 'dry') fs.mkdirSync(target);
else if (scenario !== 'missing-parent') fs.writeFileSync(target, original);
if (scenario === 'backup-collision') fs.mkdirSync(backup);
const hostile = ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'null'].includes(scenario);
if (hostile) fs.writeFileSync(helperTarget, original);
let inspections = 0;
const inspect = () => { inspections++; throw new Error('synthetic-merge-error-canary'); };
let failure: unknown;
switch (scenario) {
  case 'error': failure = new Error('synthetic-merge-error-canary'); break;
  case 'string': failure = 'synthetic-merge-error-canary'; break;
  case 'getter': failure = Object.defineProperty(new Error(), 'message', { get: inspect }); break;
  case 'coercion': failure = { toString: inspect, [Symbol.toPrimitive]: inspect }; break;
  case 'proxy': failure = new Proxy({}, { get: inspect, getPrototypeOf: inspect }); break;
  case 'revoked': {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    failure = revoked.proxy;
    break;
  }
  case 'null': failure = null; break;
  default: assert.ok(['directory', 'missing-parent', 'backup-collision', 'success', 'dry', 'removed-cwd'].includes(scenario));
}
const originalExec = childProcess.execFileSync;
const originalWrite = fs.writeFileSync;
const originalNow = Date.now;
const originalConsole = { log: console.log, error: console.error, warn: console.warn };
const requests: { command: unknown; args: unknown }[] = [];
const out: string[] = [];
const err: string[] = [];
const streams = [out, err].map((lines) => new Writable({
  write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); },
}));
const [stdout, stderr] = streams;
assert.ok(stdout && stderr);
const realConsole = new Console({ stdout, stderr });
let writeFaults = 0;
let unexpectedWrites = 0;
try {
  Date.now = () => tick;
  Reflect.defineProperty(childProcess, 'execFileSync', { configurable: true, writable: true,
    value(command: unknown, args: unknown) {
      requests.push({ command, args });
      assert.equal(command, 'claude');
      assert.deepEqual(args, ['--version']);
      // No original delegation: force the real orchestrator's merge fallback.
      throw new Error('Synthetic unavailable CLI');
    },
  });
  const allowedWrites = new Set([target, backup, helperTarget, helperTarget + '.bak-' + tick]);
  fs.writeFileSync = (...args: Parameters<typeof fs.writeFileSync>) => {
    if (typeof args[0] !== 'string' || !allowedWrites.has(args[0])) {
      unexpectedWrites++;
      throw new Error('Unexpected fixture write');
    }
    if (hostile && (args[0] === target || args[0] === helperTarget)) {
      writeFaults++;
      throw failure;
    }
    return originalWrite(...args);
  };
  syncBuiltinESMExports();
  console.log = realConsole.log.bind(realConsole);
  console.error = realConsole.error.bind(realConsole);
  console.warn = realConsole.warn.bind(realConsole);
  // Only setup modules, never src/index.ts or gateway runtime initialization.
  const claude = await import('../../../src/setup/claude-code-setup.js');
  const gateway = importedGateway ?? await import('../../../src/setup/gateway-setup.js');
  assert.equal(requests.length, 0);
  let helperIdentity = true;
  if (hostile) {
    let caught: unknown;
    let threw = false;
    try {
      if (kind === 'claude') claude.mergeClaudeCodeConfig(helperTarget, 'fixture', { command: 'node' });
      else gateway.mergeGatewayEnvIntoSettings(helperTarget, { FIXTURE: 'value' });
    } catch (error) { threw = true; caught = error; }
    helperIdentity = threw && Object.is(caught, failure);
    assert.equal(fs.readFileSync(helperTarget, 'utf8'), original);
    assert.equal(fs.readFileSync(helperTarget + '.bak-' + tick, 'utf8'), original);
  }
  let code: number | undefined;
  let escaped = false;
  let removedCwd: string | undefined;
  if (scenario === 'removed-cwd') {
    removedCwd = join(root, 'removed-cwd');
    fs.mkdirSync(removedCwd);
    assert.deepEqual(fs.readdirSync(removedCwd), []);
    process.chdir(removedCwd);
    fs.rmdirSync(removedCwd);
  }
  try {
    code = kind === 'claude'
      ? await claude.runSetupClaudeCode([], pathToFileURL(join(project, 'src', 'index.ts')).href, { configPathOverride: target })
      : await gateway.runSetupGateway(
        scenario === 'dry' ? [] : scenario === 'removed-cwd' ? ['--apply', '--scope', 'project'] : ['--apply'],
        scenario === 'removed-cwd'
          ? { env: { LLM_GATEWAY_PORT: '4321', LLM_GATEWAY_AUTH_TOKEN: 'synthetic-intentional-token' } }
          : { settingsPathOverride: target, env: { LLM_GATEWAY_PORT: '4321', LLM_GATEWAY_AUTH_TOKEN: 'synthetic-intentional-token' } },
      );
  } catch { escaped = true; }
  assert.deepEqual(requests, kind === 'claude' ? [{ command: 'claude', args: ['--version'] }] : []);
  assert.equal(unexpectedWrites, 0);
  assert.equal(writeFaults, hostile ? 2 : 0);
  if (hostile || scenario === 'success') assert.equal(fs.readFileSync(backup, 'utf8'), original);
  if (hostile || scenario === 'backup-collision') assert.equal(fs.readFileSync(target, 'utf8'), original);
  if (scenario === 'directory' || scenario === 'dry') {
    assert.deepEqual(fs.readdirSync(target), []);
    assert.equal(fs.existsSync(backup), false);
  }
  if (scenario === 'missing-parent') assert.equal(fs.existsSync(join(root, 'missing')), false);
  if (scenario === 'backup-collision') assert.deepEqual(fs.readdirSync(backup), []);
  if (scenario === 'success') {
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {
      custom: { keep: true },
      env: { KEEP: 'value', ...(kind === 'gateway' ? {
        ANTHROPIC_BASE_URL: 'http://localhost:4321', ANTHROPIC_AUTH_TOKEN: 'synthetic-intentional-token',
      } : {}) },
      mcpServers: { other: { command: 'unchanged' }, ...(kind === 'claude' ? {
        'llm-bridge': { command: 'node', args: [join(project, 'dist', 'index.js')] },
      } : {}) },
    });
    // Explicit expected shape does not derive accepted output from parsed input.
  }
  assert.equal(fs.existsSync(join(root, '.llm-gateway')), false);
  assert.deepEqual(fs.readdirSync(project), ['dist']);
  process.stdout.write(JSON.stringify({ code, escaped, inspections, helperIdentity, removedCwd, out, err }));
} finally {
  fs.writeFileSync = originalWrite;
  childProcess.execFileSync = originalExec;
  syncBuiltinESMExports();
  Date.now = originalNow;
  Object.assign(console, originalConsole);
  for (const stream of streams) stream.destroy();
  process.chdir(cwd);
}
