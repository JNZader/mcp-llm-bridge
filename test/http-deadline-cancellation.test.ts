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

describe('HTTP generate deadline cancellation', () => {
  it('kills the CLI child when the HTTP deadline fires and returns 408', async () => {
    const originalSpawn = childProcess.spawn;
    const originalExecFile = childProcess.execFile;
    const mutableChildProcess = childProcess as unknown as {
      spawn: (...args: unknown[]) => unknown;
      execFile: (...args: unknown[]) => unknown;
    };
    const originalNodeEnv = process.env.NODE_ENV;
    const originalLogLevel = process.env.LOG_LEVEL;
    const originalHttpTimeout = process.env.GENERATE_HTTP_TIMEOUT_MS;
    const child = new FakeCliChild();
    let markChildStarted: (() => void) | undefined;
    const childStarted = new Promise<void>((resolve) => {
      markChildStarted = resolve;
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
        && args[0] === '--version';
      if (isOpenCodeProbe) {
        const probeChild = new FakeCliChild();
        queueMicrotask(() => probeChild.emitClose(0));
        return probeChild;
      }
      markChildStarted?.();
      return child;
    };
    mutableChildProcess.execFile = fakeOpenCode;
    mutableChildProcess.spawn = fakeOpenCode;
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'silent';
    process.env.GENERATE_HTTP_TIMEOUT_MS = '80';
    syncBuiltinESMExports();

    let server: ReturnType<typeof createAdaptorServer> | undefined;
    const sockets = new Set<{ destroy: () => void }>();

    try {
      const { CliOpenCodeAdapter } = await import('../src/adapters/cli-opencode.js');
      const { Router } = await import('../src/core/router.js');
      const { registerExecutionRoutes } = await import('../src/server/routes/execution.js');
      const { requestTimeout } = await import('../src/server/http-app.js');
      const vault = { getFile: () => undefined };
      const router = new Router();
      router.register(new CliOpenCodeAdapter(vault as never));
      const backup: LLMProvider = {
        id: 'backup',
        name: 'Backup',
        type: 'api',
        models: [{ id: 'opencode/big-pickle', name: 'Backup model', provider: 'backup', maxTokens: 8192 }],
        isAvailable: async () => true,
        generate: async (_request: GenerateRequest): Promise<GenerateResponse> => ({
          text: 'backup must not run', provider: 'backup', model: 'opencode/big-pickle',
          resolvedProvider: 'backup', resolvedModel: 'opencode/big-pickle', fallbackUsed: true,
        }),
      };
      router.register(backup);

      const app = new Hono();
      app.use(requestTimeout);
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

      const responsePromise = new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = http.request({
          host: '127.0.0.1',
          port: address.port,
          method: 'POST',
          path: '/v1/generate',
          headers: { 'content-type': 'application/json' },
        }, resolve);
        request.on('error', reject);
        request.end(JSON.stringify({
          prompt: 'Bearer sk-live-secret should stay redacted',
          provider: 'opencode-cli',
          model: 'opencode/big-pickle',
        }));
      });

      await Promise.race([
        childStarted,
        new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('controlled child did not start')), 1_000)),
      ]);

      const response = await Promise.race([
        responsePromise,
        new Promise<http.IncomingMessage>((_resolve, reject) => setTimeout(() => reject(new Error('no HTTP response after deadline')), 2_000)),
      ]);
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString('utf8');

      assert.equal(response.statusCode, 408);
      assert.doesNotMatch(body, /sk-live-secret/i);
      assert.deepEqual(child.killCalls.includes('SIGTERM'), true);
    } finally {
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
      if (originalHttpTimeout === undefined) delete process.env.GENERATE_HTTP_TIMEOUT_MS;
      else process.env.GENERATE_HTTP_TIMEOUT_MS = originalHttpTimeout;
    }
  });
});
