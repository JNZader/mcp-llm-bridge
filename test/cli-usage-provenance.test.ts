import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { Vault } from '../src/vault/vault.js';
import { FakeCliChild } from './helpers/fake-cli-child.js';

const originalSpawn = childProcess.spawn;
const originalExecFileSync = childProcess.execFileSync;

function replaceSpawn(value: unknown): void {
  Object.defineProperty(childProcess, 'spawn', { configurable: true, value, writable: true });
  syncBuiltinESMExports();
}

function replaceSpawnSync(value: unknown): void {
  Object.defineProperty(childProcess, 'execFileSync', { configurable: true, value, writable: true });
  syncBuiltinESMExports();
}

function restoreChildProcess(): void {
  replaceSpawn(originalSpawn);
  replaceSpawnSync(originalExecFileSync);
}

const children: FakeCliChild[] = [];
replaceSpawnSync(() => { throw new Error('OpenCode must not execute synchronously'); });
replaceSpawn(() => {
  const child = new FakeCliChild();
  children.push(child);
  return child;
});

let openCode: typeof import('../src/adapters/cli-opencode.js');

describe('OpenCode CLI usage provenance', () => {
  before(async () => {
    openCode = await import('../src/adapters/cli-opencode.js');
  });

  beforeEach(() => {
    children.length = 0;
  });

  after(() => {
    restoreChildProcess();
  });

  it('classifies the complete event and counter matrix without treating metadata as billing', () => {
    const { classifyOpenCodeUsage, extractOpenCodeUsageProvenance, parseOpenCodeOutput } = openCode;
    const cases: ReadonlyArray<{ name: string; tokens: unknown; events: number; expected: unknown }> = [
      { name: 'no finish events', tokens: undefined, events: 0, expected: { status: 'unknown', reason: 'absent' } },
      { name: 'zero counters', tokens: { input: 0, output: 0 }, events: 1, expected: { status: 'reported', origin: 'cli-output', eventCount: 1, inputTokens: 0, outputTokens: 0 } },
      { name: 'positive counters', tokens: { input: 2, output: 3 }, events: 1, expected: { status: 'reported', origin: 'cli-output', eventCount: 1, inputTokens: 2, outputTokens: 3 } },
      { name: 'input-only counter', tokens: { input: 2 }, events: 1, expected: { status: 'partial', origin: 'cli-output', eventCount: 1, inputTokens: 2 } },
      { name: 'output-only counter', tokens: { output: 3 }, events: 1, expected: { status: 'partial', origin: 'cli-output', eventCount: 1, outputTokens: 3 } },
      { name: 'missing tokens', tokens: {}, events: 1, expected: { status: 'unknown', reason: 'absent' } },
      { name: 'invalid string', tokens: { input: '2', output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'invalid null', tokens: { input: null, output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'invalid boolean', tokens: { input: true, output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'invalid fraction', tokens: { input: 1.5, output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'invalid negative', tokens: { input: -1, output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'invalid nonfinite', tokens: { input: Infinity, output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'invalid unsafe integer', tokens: { input: Number.MAX_SAFE_INTEGER + 1, output: 3 }, events: 1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'safe components overflow', tokens: { input: Number.MAX_SAFE_INTEGER, output: 1 }, events: 1, expected: { status: 'unknown', reason: 'overflow' } },
      { name: 'multiple events', tokens: { input: 2, output: 3 }, events: 2, expected: { status: 'unknown', reason: 'multiple-events' } },
      { name: 'negative event count', tokens: { input: 2, output: 3 }, events: -1, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'fractional event count', tokens: { input: 2, output: 3 }, events: 1.5, expected: { status: 'unknown', reason: 'invalid' } },
      { name: 'nonfinite event count', tokens: { input: 2, output: 3 }, events: Number.NaN, expected: { status: 'unknown', reason: 'invalid' } },
    ];

    for (const item of cases) assert.deepEqual(classifyOpenCodeUsage(item.tokens, item.events), item.expected, item.name);
    assert.deepEqual(extractOpenCodeUsageProvenance('{bad json}\n{"type":"step_finish","part":{"tokens":{"input":2,"output":3}}}'), {
      status: 'reported', origin: 'cli-output', eventCount: 1, inputTokens: 2, outputTokens: 3,
    });
    assert.deepEqual(extractOpenCodeUsageProvenance('{"type":"step_finish","part":{"tokens":{"input":2}}}\n{"type":"step_finish","part":{}}'), {
      status: 'unknown', reason: 'multiple-events',
    });
    assert.deepEqual(parseOpenCodeOutput('{"type":"step_finish","part":{"tokens":{"input":2,"output":3}}}\n{"type":"step_finish","part":{"tokens":{"output":5}}}'), {
      text: '', tokens: { output: 5 },
    });
  });

  it('preserves legacy totals and provenance for every successful direct-generation shape', async () => {
    const cases = [
      { name: 'positive', events: '{"type":"step_finish","part":{"tokens":{"input":2,"output":3}}}', tokensUsed: 5, usageProvenance: { status: 'reported', origin: 'cli-output', eventCount: 1, inputTokens: 2, outputTokens: 3 } },
      { name: 'reported zero', events: '{"type":"step_finish","part":{"tokens":{"input":0,"output":0}}}', tokensUsed: 0, usageProvenance: { status: 'reported', origin: 'cli-output', eventCount: 1, inputTokens: 0, outputTokens: 0 } },
      { name: 'partial input', events: '{"type":"step_finish","part":{"tokens":{"input":2}}}', tokensUsed: 2, usageProvenance: { status: 'partial', origin: 'cli-output', eventCount: 1, inputTokens: 2 } },
      { name: 'partial output', events: '{"type":"step_finish","part":{"tokens":{"output":3}}}', tokensUsed: 3, usageProvenance: { status: 'partial', origin: 'cli-output', eventCount: 1, outputTokens: 3 } },
      { name: 'absent', events: '', tokensUsed: 0, usageProvenance: { status: 'unknown', reason: 'absent' } },
      { name: 'multiple latest', events: '{"type":"step_finish","part":{"tokens":{"input":2,"output":3}}}\n{"type":"step_finish","part":{"tokens":{"input":7,"output":11}}}', tokensUsed: 18, usageProvenance: { status: 'unknown', reason: 'multiple-events' } },
      { name: 'later finish missing usage', events: '{"type":"step_finish","part":{"tokens":{"input":2,"output":3}}}\n{"type":"step_finish","part":{}}', tokensUsed: 5, usageProvenance: { status: 'unknown', reason: 'multiple-events' } },
    ] as const;

    for (const item of cases) {
      const { CliOpenCodeAdapter } = openCode;
      const adapter = new CliOpenCodeAdapter({ getFile: () => undefined } as unknown as Vault);
      const pending = adapter.generate({ prompt: 'synthetic request', model: `opencode/${item.name.replaceAll(' ', '-')}` });
      const child = children.at(-1);
      assert.ok(child);
      child.emitStdout(`{"type":"text","part":{"text":"synthetic answer"}}\n${item.events}\n`);
      child.emitClose(0);
      const response = await pending;
      assert.equal(response.tokensUsed, item.tokensUsed, item.name);
      assert.deepEqual(response.usageProvenance, item.usageProvenance, item.name);
      assert.equal(response.text, 'synthetic answer', item.name);
    }
  });

  it('keeps nonzero stdout recovery at zero legacy tokens and omits provenance', async () => {
    const { CliOpenCodeAdapter } = openCode;
    const adapter = new CliOpenCodeAdapter({ getFile: () => undefined } as unknown as Vault);
    const pending = adapter.generate({ prompt: 'synthetic recovery' });
    const child = children.at(-1);
    assert.ok(child);
    child.emitStdout('{"type":"text","part":{"text":"recovered"}}\n{"type":"step_finish","part":{"tokens":{"input":2,"output":3}}}\n');
    child.emitClose(1);
    assert.deepEqual(await pending, {
      text: 'recovered', provider: 'opencode-cli', model: 'opencode/big-pickle', tokensUsed: 0,
      resolvedProvider: 'opencode-cli', resolvedModel: 'opencode/big-pickle', fallbackUsed: false,
      stop_reason: 'stop',
      finish_reason: 'stop',
    });
  });
});
