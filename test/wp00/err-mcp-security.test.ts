import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProfileEnforcer } from '../../src/security/enforcer.js';

const CANARY = 'private-mcp-security-canary';
const DENIED = { isError: true, content: [{ type: 'text', text: 'Access is denied.' }] };
// Fixed public copy approved for this unit, not a new SafeError code.
const LIMITED = { isError: true, content: [{ type: 'text', text: 'Rate limit exceeded.' }] };
const SUCCESS = { content: [{ type: 'text', text: 'Intentional tool output' }] };

interface DelegatedCall {
  name: string;
  args: Record<string, unknown>;
}

function tool(name: string) {
  return { name, description: 'Intentional description for ' + name,
    inputSchema: { type: 'object', properties: {} } };
}

async function fixture(
  profile: string,
  run: (client: Client, enforcer: ProfileEnforcer, calls: DelegatedCall[]) => Promise<void>,
) {
  const enforcer = new ProfileEnforcer(profile);
  const server = new Server({ name: 'security-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
  const client = new Client({ name: 'security-fixture-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const calls: DelegatedCall[] = [];
  try {
    enforcer.registerDynamicTool('fixture_dynamic_read', 'read');
    enforcer.wrapHandlers(server,
      ['llm_generate', 'vault_store', 'vault_list', 'fixture_dynamic_read', CANARY].map(tool),
      async (name, args) => { calls.push({ name, args }); return SUCCESS; });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client, enforcer, calls);
  } finally {
    enforcer.destroy();
    try { await client.close(); } finally { await server.close(); }
  }
}

function call(client: Client, name: string, args?: Record<string, unknown>) {
  return client.callTool({ name, ...(args === undefined ? {} : { arguments: args }) },
    undefined, { timeout: 2000 });
}

describe('MCP security public response containment', () => {
  for (const name of [CANARY, 'vault_store']) {
    it('returns a closed denial before rate checking for ' + name, { timeout: 5000 }, async () => {
      await fixture('restricted', async (client, enforcer, calls) => {
        const original = enforcer.checkRate;
        let rateChecks = 0;
        enforcer.checkRate = () => { rateChecks++; return { allowed: false, retryAfter: 987654 }; };
        try {
          const result = await call(client, name, { privateArgument: CANARY });
          assert.deepEqual(result, DENIED);
          assert.equal(JSON.stringify(result).includes(CANARY), false);
          assert.equal(rateChecks, 0);
          assert.deepEqual(calls, []);
        } finally { enforcer.checkRate = original; }
      });
    });
  }

  it('preserves the real open-profile quota and returns a constant exhausted response', { timeout: 5000 }, async () => {
    await fixture('open', async (client, _enforcer, calls) => {
      for (let index = 0; index < 10; index++) {
        assert.deepEqual(await call(client, 'llm_generate'), SUCCESS);
      }
      assert.deepEqual(await call(client, 'llm_generate', { prompt: CANARY }), LIMITED);
      assert.equal(calls.length, 10);
      assert.ok(calls.every((entry) => entry.name === 'llm_generate'));
    });
  });

  it('does not inspect retry data while projecting a rate rejection', { timeout: 5000 }, async () => {
    await fixture('open', async (client, enforcer, calls) => {
      const original = enforcer.checkRate;
      let accesses = 0;
      const limited = Object.defineProperty({ allowed: false }, 'retryAfter', {
        get() { accesses++; throw new Error(CANARY); },
      });
      enforcer.checkRate = () => limited;
      try {
        assert.deepEqual(await call(client, 'llm_generate'), LIMITED);
        assert.equal(accesses, 0);
        assert.deepEqual(calls, []);
      } finally { enforcer.checkRate = original; }
    });
  });

  it('preserves ListTools filtering and explicitly registered dynamic tool metadata', { timeout: 5000 }, async () => {
    await fixture('restricted', async (client, _enforcer, calls) => {
      const result = await client.listTools({}, { timeout: 2000 });
      assert.deepEqual(result.tools, ['llm_generate', 'vault_list', 'fixture_dynamic_read'].map(tool));
      assert.deepEqual(calls, []);
      assert.deepEqual(await call(client, 'fixture_dynamic_read', { project: CANARY }), SUCCESS);
      assert.deepEqual(calls, [{ name: 'fixture_dynamic_read', args: { project: CANARY } }]);
    });
  });

  it('keeps disallowed dynamic tools hidden and denied', { timeout: 5000 }, async () => {
    await fixture('open', async (client, _enforcer, calls) => {
      const listed = await client.listTools({}, { timeout: 2000 });
      assert.deepEqual(listed.tools, [tool('llm_generate')]);
      assert.deepEqual(await call(client, 'fixture_dynamic_read'), DENIED);
      assert.deepEqual(calls, []);
    });
  });

  it('preserves successful argument payloads and missing-argument defaults', { timeout: 5000 }, async () => {
    await fixture('local-dev', async (client, _enforcer, calls) => {
      const args = { prompt: CANARY, nested: { intentional: true }, values: [1, 2] };
      assert.deepEqual(await call(client, 'llm_generate', args), SUCCESS);
      assert.deepEqual(await call(client, 'llm_generate'), SUCCESS);
      assert.deepEqual(calls, [{ name: 'llm_generate', args }, { name: 'llm_generate', args: {} }]);
    });
  });
});
