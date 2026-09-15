import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_COMMAND, PROOF_VERSION, buildProofEnvironment, runProof } from './devcontainer-mcp-http-proof.js';
import { buildLifecycleCommands, parseArguments } from './run-devcontainer-mcp-http-proof.js';

test('host runner is opt-in', () => {
  assert.deepEqual(parseArguments([]), { run: false });
  assert.deepEqual(parseArguments(['--run']), { run: true });
});

test('proof environment is isolated and explicit', () => {
  const env = buildProofEnvironment({ PATH: '/bin', ADMIN_TOKEN: 'secret', OPENAI_API_KEY: 'secret' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.ADMIN_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, '');
  assert.equal(env.LLM_GATEWAY_DB_PATH, '/tmp/wp00-devcontainer-proof/vault.db');
  assert.equal(env.MCP_DYNAMIC_SERVERS, 'false');
});

test('lifecycle commands use one up and one exec without destructive flags', () => {
  const commands = buildLifecycleCommands('/workspace/project', 'unique');
  assert.deepEqual(commands.up.args.slice(0, 2), ['up', '--workspace-folder']);
  assert.deepEqual(commands.exec.args.slice(0, 2), ['exec', '--workspace-folder']);
  assert.equal(commands.up.args.includes('--remove-existing-container'), false);
  assert.equal(commands.up.args.includes('--build'), false);
  assert.equal(commands.up.args.includes('--network'), false);
  assert.deepEqual(commands.up.args.slice(-2), ['--id-label', commands.label]);
  assert.ok(commands.exec.args.includes('--id-label'));
  assert.deepEqual(
    commands.exec.args.slice(commands.exec.args.indexOf('--id-label'), commands.exec.args.indexOf('--id-label') + 2),
    ['--id-label', commands.label],
  );
  assert.equal(commands.up.args.filter((arg) => arg === 'up').length, 1);
  assert.equal(commands.exec.args.filter((arg) => arg === 'exec').length, 1);
  assert.match(commands.userDataFolder, /unique/);
  assert.match(commands.label, /unique/);
  assert.deepEqual(commands.exec.args.slice(-4), [...APP_COMMAND.slice(0, 1), '--import', 'tsx', 'test/wp00/devcontainer-mcp-http-proof.ts']);
});

test('proof performs one list, one health call, and always closes', async () => {
  let listRequests = 0;
  const requestMethods: string[] = [];
  let healthCalls = 0;
  let closes = 0;
  const receipt = await runProof({
    createClient: () => ({
      request: async (request) => {
        listRequests += 1;
        requestMethods.push(request.method);
        assert.deepEqual(request, { method: 'tools/list', params: {} });
        return { tools: [{ name: 'one' }, { name: 'two' }] };
      },
      close: async () => { closes += 1; },
    }),
    fetchHealth: async () => {
      healthCalls += 1;
      return { status: 200, json: async () => ({ status: 'ok', providers: { available: 0 } }) };
    },
  });
  assert.equal(listRequests, 1);
  assert.deepEqual(requestMethods, ['tools/list']);
  assert.equal(healthCalls, 1);
  assert.equal(closes, 1);
  assert.deepEqual(receipt, {
    version: PROOF_VERSION,
    status: 'passed',
    mcp: { operation: 'tools/list', toolCount: 2 },
    health: { operation: 'GET /health', httpStatus: 200, status: 'ok' },
    boundaries: ['MCP tools/list and loopback /health only', 'No provider or generation readiness claim', 'No MCP tool invocation'],
  });
});

test('health failures still close the client', async () => {
  let closes = 0;
  await assert.rejects(() => runProof({
    createClient: () => ({ request: async () => ({ tools: [] }), close: async () => { closes += 1; } }),
    fetchHealth: async () => ({ status: 503, json: async () => ({ status: 'down' }) }),
  }));
  assert.equal(closes, 1);
});
