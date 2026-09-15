import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { Console } from 'node:console';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const [root, marker, scenario] = process.argv.slice(2);
assert.ok(root && marker && scenario);
assert.ok(isAbsolute(root));
assert.ok(basename(root).startsWith('wp00-setup-claude-'));
assert.equal(process.env['HOME'], root);
assert.equal(homedir(), root);
assert.equal(realpathSync(root), root);
assert.equal(lstatSync(root).isSymbolicLink(), false);
assert.equal(lstatSync(root).isDirectory(), true);
assert.deepEqual(readdirSync(root), ['fixture-marker']);
assert.equal(readFileSync(join(root, 'fixture-marker'), 'utf8'), marker);
// Never import src/index.ts: it starts the CLI. Only synthetic paths follow.
const cwd = process.cwd();
const project = join(root, 'project');
const dist = join(project, 'dist');
mkdirSync(dist, { recursive: true });
process.chdir(project);
const entrypoint = join(dist, 'index.js');
if (scenario !== 'build-missing') writeFileSync(entrypoint, 'throw new Error("Fixture must not execute");\n');
const config = join(root, '.claude.json');
const originalConfig = '{"custom":{"keep":true},"mcpServers":{"other":{"command":"unchanged"}}}\n';
writeFileSync(config, originalConfig, { mode: 0o600 });
const CANARY = 'synthetic-setup-private-canary';
const controls = ['success', 'project', 'project-equals', 'absent', 'build-missing'];
const invalid = scenario.startsWith('scope-');
const hostile = !invalid && !controls.includes(scenario);
const scope = scenario.startsWith('project') ? 'project' : 'user';
let inspections = 0;
let calls = 0;
const requests: { command: unknown; args: unknown }[] = [];
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
  default: assert.ok(invalid || controls.includes(scenario));
}
const originalExec = childProcess.execFileSync;
const originalConsole = { log: console.log, error: console.error, warn: console.warn };
const out: string[] = [];
const err: string[] = [];
const warn: string[] = [];
const streams = [out, err, warn].map((lines) => new Writable({
  write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); },
}));
const [outStream, errStream, warnStream] = streams;
assert.ok(outStream && errStream && warnStream);
const realConsole = new Console({ stdout: outStream, stderr: errStream });
const warningConsole = new Console({ stdout: warnStream, stderr: warnStream });
try {
  // This replacement NEVER delegates. Unexpected commands/arguments abort.
  Reflect.defineProperty(childProcess, 'execFileSync', { configurable: true, writable: true,
    value(command: unknown, args: unknown) {
      calls++;
      requests.push({ command, args });
      assert.equal(command, 'claude');
      if (calls === 1) {
        assert.deepEqual(args, ['--version']);
        if (scenario === 'absent') throw new Error('Synthetic CLI unavailable');
        return 'synthetic version';
      }
      assert.equal(calls, 2);
      assert.deepEqual(args, ['mcp', 'add', '--transport', 'stdio', '--scope', scope, 'llm-bridge', '--', 'node', entrypoint]);
      if (hostile) throw failure;
      return 'registered';
    },
  });
  syncBuiltinESMExports();
  console.log = realConsole.log.bind(realConsole);
  console.error = realConsole.error.bind(realConsole);
  console.warn = warningConsole.warn.bind(warningConsole);
  const { runSetupClaudeCode } = await import('../../../src/setup/claude-code-setup.js');
  assert.equal(calls, 0);
  const argv = scenario === 'scope-separated' ? ['--scope', CANARY]
    : scenario === 'scope-equals' ? ['--scope=' + CANARY]
    : scenario === 'scope-missing' ? ['--scope']
    : scenario === 'project' ? ['--scope', 'project']
    : scenario === 'project-equals' ? ['--scope=project'] : [];
  let code: number | undefined;
  let escaped = false;
  try { code = await runSetupClaudeCode(argv, pathToFileURL(join(project, 'src', 'index.ts')).href); }
  catch { escaped = true; }
  // Repeat command assertions outside production catches, which may swallow them.
  for (const [index, request] of requests.entries()) {
    assert.equal(request.command, 'claude');
    assert.ok(index < 2);
    assert.deepEqual(request.args, index === 0 ? ['--version']
      : ['mcp', 'add', '--transport', 'stdio', '--scope', scope, 'llm-bridge', '--', 'node', entrypoint]);
  }
  const current = readFileSync(config, 'utf8');
  const merged = current !== originalConfig;
  const backups = readdirSync(root).filter((name) => name.startsWith('.claude.json.bak-'));
  assert.equal(backups.length, merged ? 1 : 0);
  if (merged) {
    assert.deepEqual(JSON.parse(current), {
      custom: { keep: true }, mcpServers: {
        other: { command: 'unchanged' }, 'llm-bridge': { command: 'node', args: [entrypoint] },
      },
    });
    assert.equal(readFileSync(join(root, backups[0]!), 'utf8'), originalConfig);
  }
  assert.equal(existsSync(join(root, '.llm-gateway')), false);
  assert.deepEqual(readdirSync(project), ['dist']);
  process.stdout.write(JSON.stringify({ code, escaped, inspections, calls, merged, backup: backups.length === 1, out, err, warn }));
} finally {
  childProcess.execFileSync = originalExec;
  syncBuiltinESMExports();
  Object.assign(console, originalConsole);
  for (const stream of streams) stream.destroy();
  process.chdir(cwd);
}
