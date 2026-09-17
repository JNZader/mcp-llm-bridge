import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_CLI_GENERATE_TIMEOUT_MS } from '../src/core/constants.js';
import { FakeCliChild } from './helpers/fake-cli-child.js';
import {
  cleanupAllProviderHomes,
  materializeProviderHome,
  materializeRequestProviderHome,
} from '../src/adapters/cli-home.js';

const LOGICAL_PROVIDER_ROOT = '/tmp/llm-gw';
const syntheticFiles = [{ fileName: 'auth.json', content: '{"token":"synthetic"}' }];

function asStringPath(path: unknown): string {
  assert.ok(typeof path === 'string');
  return path;
}

describe('request-owned CLI homes', () => {
  it('keeps all provider-home filesystem effects inside its supervisor-owned scratch directory', async (t) => {
    const originalMkdirSync = fs.mkdirSync;
    const originalMkdtempSync = fs.mkdtempSync;
    const originalChmodSync = fs.chmodSync;
    const originalWriteFileSync = fs.writeFileSync;
    const originalRmSync = fs.rmSync;
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;
    const originalReaddirSync = fs.readdirSync;
    const originalExecFileSync = childProcess.execFileSync;
    const originalSpawn = childProcess.spawn;
    const supervisorTmp = process.env.TMPDIR ?? tmpdir();
    const suiteRoot = originalMkdtempSync(join(supervisorTmp, 'cli-home-request-ownership-'));
    const routedRoot = join(suiteRoot, 'llm-gw');
    const cleanupActions: Array<() => void> = [];
    let failureProvider = '';
    let failOneCandidateWrite = false;
    let failureInjected = false;

    const routePath = (path: unknown): string => {
      const logicalPath = asStringPath(path);
      if (logicalPath === LOGICAL_PROVIDER_ROOT) return routedRoot;
      if (logicalPath.startsWith(`${LOGICAL_PROVIDER_ROOT}/`)) {
        return join(routedRoot, logicalPath.slice(LOGICAL_PROVIDER_ROOT.length + 1));
      }
      return logicalPath;
    };
    const physicalPath = (path: string): string => routePath(path);

    Object.defineProperty(fs, 'mkdirSync', { configurable: true, writable: true, value: (...args: unknown[]) => Reflect.apply(
      originalMkdirSync,
      fs,
      [routePath(args[0]), ...args.slice(1)],
    ) });
    Object.defineProperty(fs, 'mkdtempSync', { configurable: true, writable: true, value: (...args: unknown[]) => Reflect.apply(
      originalMkdtempSync,
      fs,
      [routePath(args[0]), ...args.slice(1)],
    ) });
    Object.defineProperty(fs, 'chmodSync', { configurable: true, writable: true, value: (...args: unknown[]) => Reflect.apply(
      originalChmodSync,
      fs,
      [routePath(args[0]), ...args.slice(1)],
    ) });
    Object.defineProperty(fs, 'writeFileSync', { configurable: true, writable: true, value: (...args: unknown[]) => {
      const targetPath = routePath(args[0]);
      const isScopedCandidate = failureProvider.length > 0
        && targetPath.includes(`${failureProvider}-request-`)
        && targetPath.endsWith(`.${failureProvider}/auth.json`);
      if (failOneCandidateWrite && !failureInjected && isScopedCandidate) {
        failureInjected = true;
        throw new Error('synthetic scoped write failure');
      }
      return Reflect.apply(originalWriteFileSync, fs, [targetPath, ...args.slice(1)]);
    } });
    Object.defineProperty(fs, 'rmSync', { configurable: true, writable: true, value: (...args: unknown[]) => Reflect.apply(
      originalRmSync,
      fs,
      [routePath(args[0]), ...args.slice(1)],
    ) });
    syncBuiltinESMExports();

    try {
      cleanupAllProviderHomes();

      const scenarioProvider = `request-home-a-${process.pid}`;
      const cached = materializeProviderHome(scenarioProvider, syntheticFiles, 'shared-project');
      const cachedAgain = materializeProviderHome(scenarioProvider, syntheticFiles, 'shared-project');
      const requestA = materializeRequestProviderHome(scenarioProvider, syntheticFiles, 'shared-project');
      const requestB = materializeRequestProviderHome(scenarioProvider, syntheticFiles, 'shared-project');
      const changed = materializeRequestProviderHome(
        scenarioProvider,
        [{ fileName: 'auth.json', content: '{"token":"changed"}' }],
        'shared-project',
      );
      cleanupActions.push(cached.cleanup, requestA.cleanup, requestB.cleanup, changed.cleanup);

      assert.equal(cachedAgain.homeDir, cached.homeDir, 'cached API retains identical-input reuse');
      assert.notEqual(requestA.homeDir, requestB.homeDir);
      assert.notEqual(requestA.homeDir, changed.homeDir);
      assert.notEqual(requestA.homeDir, cached.homeDir);
      assert.equal(originalReadFileSync(join(requestA.targetDir, 'auth.json'), 'utf8'), syntheticFiles[0]?.content);
      assert.equal(originalReadFileSync(join(changed.targetDir, 'auth.json'), 'utf8'), '{"token":"changed"}');

      requestA.cleanup();
      requestA.cleanup();
      assert.equal(originalExistsSync(physicalPath(requestA.homeDir)), false);
      assert.equal(originalExistsSync(physicalPath(requestB.homeDir)), true);
      assert.equal(originalExistsSync(physicalPath(cached.homeDir)), true);
      cached.cleanup();
      assert.equal(originalExistsSync(physicalPath(cached.homeDir)), false);
      assert.equal(originalExistsSync(physicalPath(requestB.homeDir)), true);
      requestB.cleanup();
      changed.cleanup();

      const reverseProvider = `request-home-reverse-${process.pid}`;
      const reverseCache = materializeProviderHome(reverseProvider, syntheticFiles, 'shared-project');
      const reverseCacheAgain = materializeProviderHome(reverseProvider, syntheticFiles, 'shared-project');
      const reverseA = materializeRequestProviderHome(reverseProvider, syntheticFiles, 'shared-project');
      const reverseB = materializeRequestProviderHome(
        reverseProvider,
        [{ fileName: 'auth.json', content: '{"token":"changed-again"}' }],
        'shared-project',
      );
      cleanupActions.push(reverseCache.cleanup, reverseA.cleanup, reverseB.cleanup);

      assert.equal(reverseCacheAgain.homeDir, reverseCache.homeDir, 'reverse scenario verifies the cache identity hit');
      reverseCache.cleanup();
      assert.equal(originalExistsSync(physicalPath(reverseCache.homeDir)), false);
      assert.equal(originalExistsSync(physicalPath(reverseA.homeDir)), true);
      assert.equal(originalExistsSync(physicalPath(reverseB.homeDir)), true);
      reverseB.cleanup();
      assert.equal(originalExistsSync(physicalPath(reverseA.homeDir)), true);
      reverseA.cleanup();

      failureProvider = `request-home-failure-${process.pid}`;
      const sibling = materializeRequestProviderHome(failureProvider, syntheticFiles, 'shared-project');
      cleanupActions.push(sibling.cleanup);
      failOneCandidateWrite = true;
      assert.throws(
        () => materializeRequestProviderHome(failureProvider, syntheticFiles, 'shared-project'),
        /synthetic scoped write failure/,
      );
      failOneCandidateWrite = false;
      assert.equal(failureInjected, true);
      assert.equal(originalReadFileSync(join(sibling.targetDir, 'auth.json'), 'utf8'), syntheticFiles[0]?.content);
      const routedEntries = originalReaddirSync(routedRoot);
      assert.equal(
        routedEntries.some((entry) => entry.startsWith(`${failureProvider}-request-`) && entry !== sibling.homeDir.split('/').at(-1)),
        false,
      );
      sibling.cleanup();

      const children: FakeCliChild[] = [];
      const observedHomes: string[] = [];
      Object.defineProperty(childProcess, 'execFileSync', { configurable: true, writable: true, value: () => {
        throw new Error('Base must not use sync execution');
      } });
      Object.defineProperty(childProcess, 'spawn', { configurable: true, writable: true, value: (...args: unknown[]) => {
        const options = args[2];
        assert.ok(typeof options === 'object' && options !== null);
        const env = Reflect.get(options, 'env');
        assert.ok(typeof env === 'object' && env !== null);
        const home = Reflect.get(env, 'HOME');
        assert.ok(home);
        observedHomes.push(home);
        assert.ok(physicalPath(home).startsWith(`${suiteRoot}/`));
        assert.equal(originalReadFileSync(join(physicalPath(home), '.request-base-cli', 'auth.json'), 'utf8'), syntheticFiles[0]?.content);
        const child = new FakeCliChild();
        children.push(child);
        return child;
      } });
      syncBuiltinESMExports();

      const { BaseCliAdapter } = await import('../src/adapters/base-cli-adapter.js');
      class TestAdapter extends BaseCliAdapter {
        readonly config = { id: 'request-base', name: 'Request Base', cliCommand: 'request-base-cli', defaultModel: 'test-model', models: [] };
        protected buildArgs(): string[] { return ['synthetic']; }
        protected parseResponse(output: string): string { return output; }
      }
      const vault = Object.create(null);
      vault.getProviderFiles = () => syntheticFiles;
      const adapter = new TestAdapter(vault);
      const first = adapter.generate({ prompt: 'first', project: 'synthetic-project' });
      const second = adapter.generate({ prompt: 'second', project: 'synthetic-project' });
      assert.equal(children.length, 2);
      const firstHome = observedHomes[0];
      const secondHome = observedHomes[1];
      assert.ok(firstHome);
      assert.ok(secondHome);
      assert.notEqual(firstHome, secondHome);
      assert.equal(originalExistsSync(physicalPath(firstHome)), true);
      assert.equal(originalExistsSync(physicalPath(secondHome)), true);
      children[1]?.emitStdout('second success');
      children[1]?.emitClose(0);
      assert.equal((await second).text, 'second success');
      assert.equal(originalExistsSync(physicalPath(secondHome)), false);
      assert.equal(originalExistsSync(physicalPath(firstHome)), true);
      children[0]?.emitStdout('first success');
      children[0]?.emitClose(0);
      assert.equal((await first).text, 'first success');
      assert.equal(originalExistsSync(physicalPath(firstHome)), false);

      const processFailure = adapter.generate({ prompt: 'process failure', project: 'synthetic-project' });
      const processRejected = assert.rejects(processFailure, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Request Base CLI failed: CLI process error');
        assert.doesNotMatch(error.message, /synthetic child failure/);
        return true;
      });
      const processChild = children.at(-1);
      const processHome = observedHomes.at(-1);
      assert.ok(processChild);
      assert.ok(processHome);
      processChild.emitProcessError(new Error('synthetic child failure'));
      processChild.emitClose(1);
      await processRejected;
      assert.equal(originalExistsSync(physicalPath(processHome)), false);

      const controller = new AbortController();
      const cancelled = adapter.generate({ prompt: 'cancel', project: 'synthetic-project' }, { signal: controller.signal });
      const cancelledRejected = assert.rejects(cancelled, /Generation cancelled/);
      const cancellationSibling = adapter.generate({ prompt: 'cancel sibling', project: 'synthetic-project' });
      const cancelledChild = children.at(-2);
      const cancellationSiblingChild = children.at(-1);
      const cancelledHome = observedHomes.at(-2);
      const cancellationSiblingHome = observedHomes.at(-1);
      assert.ok(cancelledChild);
      assert.ok(cancellationSiblingChild);
      assert.ok(cancelledHome);
      assert.ok(cancellationSiblingHome);
      controller.abort();
      assert.deepEqual(cancelledChild.killCalls, ['SIGTERM']);
      assert.deepEqual(cancellationSiblingChild.killCalls, []);
      assert.equal(originalExistsSync(physicalPath(cancelledHome)), true);
      assert.equal(originalExistsSync(physicalPath(cancellationSiblingHome)), true);
      assert.equal(originalReadFileSync(join(physicalPath(cancellationSiblingHome), '.request-base-cli', 'auth.json'), 'utf8'), syntheticFiles[0]?.content);
      cancelledChild.emitExit(0);
      assert.equal(originalExistsSync(physicalPath(cancelledHome)), true, 'exit alone preserves the request home');
      cancelledChild.emitClose(0);
      await cancelledRejected;
      assert.equal(originalExistsSync(physicalPath(cancelledHome)), false);
      assert.equal(originalExistsSync(physicalPath(cancellationSiblingHome)), true);
      cancellationSiblingChild.emitStdout('sibling success');
      cancellationSiblingChild.emitClose(0);
      assert.equal((await cancellationSibling).text, 'sibling success');
      assert.equal(originalExistsSync(physicalPath(cancellationSiblingHome)), false);

      t.mock.timers.enable({ apis: ['setTimeout'] });
      const timedOut = adapter.generate({ prompt: 'deadline', project: 'synthetic-project' });
      const timedOutRejected = assert.rejects(timedOut, /Request Base CLI timed out/);
      const timedOutChild = children.at(-1);
      const timedOutHome = observedHomes.at(-1);
      assert.ok(timedOutChild);
      assert.ok(timedOutHome);
      t.mock.timers.tick(DEFAULT_CLI_GENERATE_TIMEOUT_MS);
      assert.deepEqual(timedOutChild.killCalls, ['SIGTERM']);
      assert.equal(originalExistsSync(physicalPath(timedOutHome)), true);
      const siblingLive = adapter.generate({ prompt: 'deadline sibling', project: 'synthetic-project' });
      const siblingChild = children.at(-1);
      const siblingHome = observedHomes.at(-1);
      assert.ok(siblingChild);
      assert.ok(siblingHome);
      assert.deepEqual(siblingChild.killCalls, []);
      timedOutChild.emitExit(0);
      assert.equal(originalExistsSync(physicalPath(timedOutHome)), true, 'deadline does not clean before close');
      timedOutChild.emitClose(0);
      await timedOutRejected;
      assert.equal(originalExistsSync(physicalPath(timedOutHome)), false);
      assert.equal(originalExistsSync(physicalPath(siblingHome)), true, 'closing one request keeps its sibling home');
      assert.deepEqual(siblingChild.killCalls, []);
      siblingChild.emitStdout('deadline sibling success');
      siblingChild.emitClose(0);
      assert.equal((await siblingLive).text, 'deadline sibling success');
      assert.equal(originalExistsSync(physicalPath(siblingHome)), false);
    } finally {
      t.mock.timers.reset();
      for (const cleanup of cleanupActions.reverse()) cleanup();
      cleanupAllProviderHomes();
      Object.defineProperty(childProcess, 'execFileSync', { configurable: true, value: originalExecFileSync, writable: true });
      Object.defineProperty(childProcess, 'spawn', { configurable: true, value: originalSpawn, writable: true });
      Object.defineProperty(fs, 'mkdirSync', { configurable: true, value: originalMkdirSync, writable: true });
      Object.defineProperty(fs, 'mkdtempSync', { configurable: true, value: originalMkdtempSync, writable: true });
      Object.defineProperty(fs, 'chmodSync', { configurable: true, value: originalChmodSync, writable: true });
      Object.defineProperty(fs, 'writeFileSync', { configurable: true, value: originalWriteFileSync, writable: true });
      Object.defineProperty(fs, 'rmSync', { configurable: true, value: originalRmSync, writable: true });
      syncBuiltinESMExports();
      try {
        assert.strictEqual(childProcess.execFileSync, originalExecFileSync);
        assert.strictEqual(fs.mkdirSync, originalMkdirSync);
        assert.strictEqual(fs.mkdtempSync, originalMkdtempSync);
        assert.strictEqual(fs.chmodSync, originalChmodSync);
        assert.strictEqual(fs.writeFileSync, originalWriteFileSync);
        assert.strictEqual(fs.rmSync, originalRmSync);
      } finally {
        originalRmSync(suiteRoot, { recursive: true, force: true });
      }
    }
  });
});
