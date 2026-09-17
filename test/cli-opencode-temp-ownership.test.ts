import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { FakeCliChild } from './helpers/fake-cli-child.js';

type Scenario = {
  readonly root?: string;
  readonly mkdtempError?: Error;
  readonly mkdirError?: Error;
  readonly writeError?: Error;
  readonly rmError?: Error;
};

type Outcome =
  | { readonly status: 'fulfilled'; readonly value: unknown }
  | { readonly status: 'rejected'; readonly message: string };

async function settle(operation: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { status: 'fulfilled', value: await operation() };
  } catch (error) {
    return { status: 'rejected', message: error instanceof Error ? error.message : String(error) };
  }
}

function rejectedMessage(outcome: Outcome): string {
  assert.equal(outcome.status, 'rejected');
  return outcome.message;
}

describe('OpenCode temporary auth directory ownership', () => {
  it('keeps request-owned roots until each async child reaches a classified close', async () => {
    const originals = {
      execFile: childProcess.execFile,
      execFileSync: childProcess.execFileSync,
      mkdtempSync: fs.mkdtempSync,
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      rmSync: fs.rmSync,
      xdgDataHome: process.env.XDG_DATA_HOME,
    };
    const mutableChildProcess = childProcess as unknown as {
      execFile: (...args: unknown[]) => unknown;
      execFileSync: (...args: unknown[]) => unknown;
    };
    const mutableFs = fs as unknown as {
      mkdtempSync: (...args: unknown[]) => unknown;
      mkdirSync: (...args: unknown[]) => unknown;
      writeFileSync: (...args: unknown[]) => unknown;
      rmSync: (...args: unknown[]) => unknown;
    };
    let authContent: string | undefined;
    let scenario: Scenario = {};
    const children: FakeCliChild[] = [];
    const calls = {
      exec: [] as unknown[][],
      mkdtemp: [] as unknown[][],
      mkdir: [] as unknown[][],
      write: [] as unknown[][],
      remove: [] as unknown[][],
    };
    const reset = (next: Scenario, auth?: string) => {
      scenario = next;
      authContent = auth;
      children.length = 0;
      for (const callList of Object.values(calls)) callList.length = 0;
    };
    const complete = (child: FakeCliChild, text = 'response') => {
      child.emitStdout(
        `{"type":"text","part":{"text":"${text}"}}\n{"type":"step_finish","part":{"tokens":{"input":1,"output":1}}}\n`,
      );
      child.emitClose(0);
    };

    mutableChildProcess.execFileSync = () => {
      throw new Error('OpenCode must not execute synchronously');
    };
    mutableChildProcess.execFile = (...args: unknown[]) => {
      calls.exec.push(args);
      const child = new FakeCliChild();
      children.push(child);
      return child;
    };
    mutableFs.mkdtempSync = (...args: unknown[]) => {
      calls.mkdtemp.push(args);
      if (scenario.mkdtempError) throw scenario.mkdtempError;
      assert.ok(scenario.root, 'auth allocation must have a planned root');
      return scenario.root;
    };
    mutableFs.mkdirSync = (...args: unknown[]) => {
      calls.mkdir.push(args);
      if (scenario.mkdirError) throw scenario.mkdirError;
    };
    mutableFs.writeFileSync = (...args: unknown[]) => {
      calls.write.push(args);
      if (scenario.writeError) throw scenario.writeError;
    };
    mutableFs.rmSync = (...args: unknown[]) => {
      calls.remove.push(args);
      if (scenario.rmError) throw scenario.rmError;
    };
    process.env.XDG_DATA_HOME = 'inherited-data-home';
    syncBuiltinESMExports();

    try {
      const { CliOpenCodeAdapter } = await import('../src/adapters/cli-opencode.js');
      const adapter = new CliOpenCodeAdapter({ getFile: () => authContent } as never);
      const generate = () => adapter.generate({ prompt: 'prompt' });
      const generateWith = (request: Parameters<typeof adapter.generate>[0]) => adapter.generate(request);

      reset({});
      const absentAuth = generate();
      assert.equal(children.length, 1);
      complete(children[0]!);
      assert.equal((await settle(() => absentAuth)).status, 'fulfilled');
      assert.equal(calls.mkdtemp.length, 0);
      assert.equal(calls.mkdir.length, 0);
      assert.equal(calls.write.length, 0);
      assert.equal(calls.remove.length, 0);
      assert.equal((calls.exec[0]?.[2] as { env: Record<string, string> }).env.XDG_DATA_HOME, 'inherited-data-home');

      reset({ root: '/memory/no-tools' });
      const strictNoTools = generateWith({ prompt: 'strict prompt', model: 'fixture/model', tools: 'none' });
      assert.deepEqual(calls.exec[0]?.[1], [
        'run', '--model', 'fixture/model', '--agent', 'gate1-no-tools', '--pure', '--dir', '/memory/no-tools', '--format', 'json',
      ]);
      const config = JSON.parse(calls.write[0]?.[1] as string) as Record<string, any>;
      assert.deepEqual(config.tools, { '*': false });
      assert.deepEqual(config.permission, { '*': 'deny' });
      complete(children[0]!);
      const strictResult = await settle(() => strictNoTools);
      assert.equal(strictResult.status, 'fulfilled');
      assert.equal((strictResult as { status: 'fulfilled'; value: { toolEvidence?: { toolCallCount: number } } }).value.toolEvidence?.toolCallCount, 0);

      reset({ root: '/memory/request-one' }, 'credential-one');
      const successfulAuth = generate();
      assert.deepEqual(calls.mkdtemp, [[join(tmpdir(), 'opencode-auth-')]]);
      assert.deepEqual(calls.mkdir, [['/memory/request-one/opencode', { recursive: true, mode: 0o700 }]]);
      assert.deepEqual(calls.write, [['/memory/request-one/opencode/auth.json', 'credential-one', { mode: 0o600 }]]);
      assert.equal((calls.exec[0]?.[2] as { env: Record<string, string> }).env.XDG_DATA_HOME, '/memory/request-one');
      complete(children[0]!);
      assert.equal((await settle(() => successfulAuth)).status, 'fulfilled');
      assert.deepEqual(calls.remove, [['/memory/request-one', { recursive: true, force: true }]]);

      reset({ mkdtempError: new Error('allocation failed') }, 'credential-two');
      assert.match(rejectedMessage(await settle(generate)), /allocation failed/);
      assert.equal(calls.exec.length, 0);
      assert.equal(calls.remove.length, 0);

      reset({ root: '/memory/mkdir-failure', mkdirError: new Error('mkdir failed') }, 'credential-three');
      assert.match(rejectedMessage(await settle(generate)), /mkdir failed/);
      assert.equal(calls.exec.length, 0);
      assert.deepEqual(calls.remove, [['/memory/mkdir-failure', { recursive: true, force: true }]]);

      reset({ root: '/memory/write-failure', writeError: new Error('write failed') }, 'credential-four');
      assert.match(rejectedMessage(await settle(generate)), /write failed/);
      assert.equal(calls.exec.length, 0);
      assert.deepEqual(calls.remove, [['/memory/write-failure', { recursive: true, force: true }]]);

      reset({ root: '/memory/timed-out' }, 'credential-five');
      const timeout = generate();
      children[0]!.emitStdout('{"type":"text","part":{"text":"partial"}}\n');
      children[0]!.emitProcessError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
      children[0]!.emitClose(1);
      assert.deepEqual(await settle(() => timeout), { status: 'rejected', message: 'OpenCode CLI timed out' });
      assert.deepEqual(calls.remove, [['/memory/timed-out', { recursive: true, force: true }]]);

      reset({ root: '/memory/first' }, 'credential-six');
      const first = generate();
      complete(children[0]!);
      assert.equal((await settle(() => first)).status, 'fulfilled');
      const firstRoot = calls.remove[0]?.[0];
      reset({ root: '/memory/second' }, 'credential-seven');
      const second = generate();
      complete(children[0]!);
      assert.equal((await settle(() => second)).status, 'fulfilled');
      assert.notEqual(firstRoot, calls.remove[0]?.[0], 'frozen clocks must not make requests share a cleanup root');

      reset({ root: '/memory/cleanup-error', rmError: new Error('cleanup failed') }, 'credential-eight');
      const cleanup = generate();
      complete(children[0]!);
      assert.match(rejectedMessage(await settle(() => cleanup)), /cleanup failed/);

      reset({ root: '/memory/pending' }, 'credential-nine');
      const pending = generate();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls.remove.length, 0, 'an event-loop yield must not clean up before close');
      children[0]!.emitProcessError(new Error('child error'));
      await Promise.resolve();
      assert.equal(calls.remove.length, 0, 'a child error must not clean up before close');
      complete(children[0]!);
      assert.equal((await settle(() => pending)).status, 'rejected');
      assert.deepEqual(calls.remove, [['/memory/pending', { recursive: true, force: true }]]);

      reset({ root: '/memory/root-one' }, 'credential-ten');
      const rootOne = generate();
      const rootOneChild = children[0]!;
      scenario = { root: '/memory/root-two' };
      authContent = 'credential-eleven';
      const rootTwo = generate();
      const rootTwoChild = children[1]!;
      complete(rootTwoChild, 'two');
      assert.equal((await settle(() => rootTwo)).status, 'fulfilled');
      assert.deepEqual(calls.remove, [['/memory/root-two', { recursive: true, force: true }]]);
      complete(rootOneChild, 'one');
      assert.equal((await settle(() => rootOne)).status, 'fulfilled');
      assert.deepEqual(calls.remove, [
        ['/memory/root-two', { recursive: true, force: true }],
        ['/memory/root-one', { recursive: true, force: true }],
      ]);

      reset({ root: '/memory/terminated' }, 'credential-twelve');
      const terminated = generate();
      children[0]!.emitStdout('{"type":"text","part":{"text":"parseable partial"}}\n');
      children[0]!.killed = true;
      children[0]!.emitClose(0);
      assert.equal((await settle(() => terminated)).status, 'rejected');
      assert.deepEqual(calls.remove, [['/memory/terminated', { recursive: true, force: true }]]);
    } finally {
      mutableChildProcess.execFile = originals.execFile as unknown as (...args: unknown[]) => unknown;
      mutableChildProcess.execFileSync = originals.execFileSync as unknown as (...args: unknown[]) => unknown;
      mutableFs.mkdtempSync = originals.mkdtempSync as unknown as (...args: unknown[]) => unknown;
      mutableFs.mkdirSync = originals.mkdirSync as unknown as (...args: unknown[]) => unknown;
      mutableFs.writeFileSync = originals.writeFileSync as unknown as (...args: unknown[]) => unknown;
      mutableFs.rmSync = originals.rmSync as unknown as (...args: unknown[]) => unknown;
      if (originals.xdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = originals.xdgDataHome;
      syncBuiltinESMExports();
      assert.strictEqual(childProcess.execFile, originals.execFile);
      assert.strictEqual(childProcess.execFileSync, originals.execFileSync);
      assert.strictEqual(fs.mkdtempSync, originals.mkdtempSync);
      assert.strictEqual(fs.mkdirSync, originals.mkdirSync);
      assert.strictEqual(fs.writeFileSync, originals.writeFileSync);
      assert.strictEqual(fs.rmSync, originals.rmSync);
    }
  });
});
