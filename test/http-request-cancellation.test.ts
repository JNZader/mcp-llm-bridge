import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';

import { FakeCliChild } from './helpers/fake-cli-child.js';
import type { GenerateRequest, GenerateResponse, LLMProvider } from '../src/core/types.js';

const completedFakeChildren = new WeakSet<FakeCliChild>();

function completeFakeChild(child: FakeCliChild, signal: NodeJS.Signals): void {
  if (completedFakeChildren.has(child)) return;
  completedFakeChildren.add(child);
  child.emitExit(null, signal);
  child.emitClose(null, signal);
}

describe('HTTP request cancellation', () => {
  it('completes a controlled pending fake child with TERM, exit, and close without stream methods', async () => {
    const child = new FakeCliChild();
    const events: string[] = [];
    const originalKill = child.kill.bind(child);
    child.on('exit', () => events.push('exit'));
    child.on('close', () => events.push('close'));
    child.kill = (signal) => {
      const result = originalKill(signal);
      if (signal === 'SIGTERM') queueMicrotask(() => completeFakeChild(child, signal));
      return result;
    };

    assert.equal(child.kill('SIGTERM'), true);
    await Promise.resolve();
    completeFakeChild(child, 'SIGTERM');

    assert.deepEqual(child.killCalls, ['SIGTERM']);
    assert.deepEqual(events, ['exit', 'close']);
  });

  it('terminates the controlled OpenCode child and does not fall back after a real client disconnect', async () => {
    const originalSpawn = childProcess.spawn;
    const originalExecFile = childProcess.execFile;
    const mutableChildProcess = childProcess as unknown as {
      spawn: (...args: unknown[]) => unknown;
      execFile: (...args: unknown[]) => unknown;
    };
    const originalNodeEnv = process.env.NODE_ENV;
    const originalLogLevel = process.env.LOG_LEVEL;
    const child = new FakeCliChild();
    let unexpectedExecCalls = 0;
    let backupCalls = 0;
    const invocationSequence: string[] = [];
    let markChildStarted: (() => void) | undefined;
    const childStarted = new Promise<void>((resolve) => {
      markChildStarted = resolve;
    });
    let markRouterSettled: (() => void) | undefined;
    const routerSettled = new Promise<void>((resolve) => {
      markRouterSettled = resolve;
    });
    const originalKill = child.kill.bind(child);

    child.kill = (signal) => {
      const result = originalKill(signal);
      if (signal === 'SIGTERM') {
        queueMicrotask(() => completeFakeChild(child, signal));
      }
      return result;
    };

    const fakeOpenCode = (command: unknown, args: unknown) => {
      const isOpenCodeProbe = command === 'opencode'
        && Array.isArray(args)
        && args.length === 1
        && args[0] === '--version';
      const isOpenCodeRun = command === 'opencode'
        && Array.isArray(args)
        && args.length === 5
        && args[0] === 'run'
        && args[1] === '--model'
        && args[2] === 'opencode/big-pickle'
        && args[3] === '--format'
        && args[4] === 'json';
      if (!isOpenCodeProbe && !isOpenCodeRun) {
        unexpectedExecCalls += 1;
        throw new Error('unexpected child-process invocation');
      }
      if (isOpenCodeProbe) {
        invocationSequence.push('opencode --version');
        const probeChild = new FakeCliChild();
        queueMicrotask(() => probeChild.emitClose(0));
        return probeChild;
      }
      invocationSequence.push('opencode run --model opencode/big-pickle --format json');
      markChildStarted?.();
      return child;
    };
    mutableChildProcess.execFile = fakeOpenCode;
    mutableChildProcess.spawn = fakeOpenCode;
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'silent';
    syncBuiltinESMExports();

    let server: ReturnType<typeof createAdaptorServer> | undefined;
    let request: http.ClientRequest | undefined;
    const sockets = new Set<{ destroy: () => void }>();

    try {
      const { CliOpenCodeAdapter } = await import('../src/adapters/cli-opencode.js');
      const { Router } = await import('../src/core/router.js');
      const { registerExecutionRoutes } = await import('../src/server/routes/execution.js');
      const vault = { getFile: () => undefined };
      const router = new Router();
      router.register(new CliOpenCodeAdapter(vault as never));
      const backup: LLMProvider = {
        id: 'backup',
        name: 'Backup',
        type: 'api',
        models: [{ id: 'opencode/big-pickle', name: 'Backup model', provider: 'backup', maxTokens: 8192 }],
        isAvailable: async () => true,
        generate: async (_request: GenerateRequest): Promise<GenerateResponse> => {
          backupCalls += 1;
          return {
            text: 'backup must not run', provider: 'backup', model: 'opencode/big-pickle',
            resolvedProvider: 'backup', resolvedModel: 'opencode/big-pickle', fallbackUsed: true,
          };
        },
      };
      router.register(backup);
      const realGenerate = router.generate.bind(router);
      router.generate = (async (...args: Parameters<typeof realGenerate>) => {
        try {
          return await realGenerate(...args);
        } finally {
          markRouterSettled?.();
        }
      }) as typeof router.generate;

      const app = new Hono();
      registerExecutionRoutes(app, { router, vault: vault as never });
      server = createAdaptorServer({ fetch: app.fetch });
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');

      request = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/v1/generate',
        headers: { 'content-type': 'application/json' },
      }, (response) => response.resume());
      request.on('error', () => undefined);
      request.end(JSON.stringify({
        prompt: 'disconnect me',
        provider: 'opencode-cli',
        model: 'opencode/big-pickle',
      }));

      await Promise.race([
        childStarted,
        new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('controlled child did not start')), 1_000)),
      ]);
      request.destroy();
      await Promise.race([
        routerSettled,
        new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('router did not settle after disconnect')), 1_000)),
      ]);

      assert.deepEqual(child.killCalls, ['SIGTERM']);
      assert.equal(backupCalls, 0);
      assert.equal(unexpectedExecCalls, 0);
      assert.deepEqual(invocationSequence, [
        'opencode --version',
        'opencode run --model opencode/big-pickle --format json',
      ]);
    } finally {
      request?.destroy();
      completeFakeChild(child, 'SIGTERM');
      for (const socket of sockets) socket.destroy();
      (server as unknown as { closeAllConnections?: () => void } | undefined)?.closeAllConnections?.();
      if (server?.listening) {
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => error ? reject(error) : resolve());
        });
      }
      mutableChildProcess.spawn = originalSpawn as unknown as (...args: unknown[]) => unknown;
      mutableChildProcess.execFile = originalExecFile as unknown as (...args: unknown[]) => unknown;
      syncBuiltinESMExports();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = originalLogLevel;
    }
  });
});
