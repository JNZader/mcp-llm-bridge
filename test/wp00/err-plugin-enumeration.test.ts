import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { loadPlugins } from '../../src/mcp-builder/loader.js';

const EMPTY = { loaded: [], skipped: [], errors: [] };
const FILE = 'synthetic.mcp-server.js';

describe('Plugin directory enumeration boundary', { concurrency: false }, () => {
  for (const stage of ['processing', 'cleanup']) {
    for (const scenario of ['enoent', 'error', 'string', 'getter', 'proxy', 'revoked', 'null']) {
      it('preserves post-enumeration ' + stage + ' ' + scenario, async () => {
        const root = mkdtempSync(join(tmpdir(), 'wp00-enumeration-'));
        const original = { readdir: fs.readdir, copyFile: fs.copyFile, rm: fs.rm };
        const enumerations: unknown[][] = [];
        const copies: unknown[][] = [];
        const removals: unknown[][] = [];
        let inspections = 0;
        const inspect = () => { inspections++; throw new Error('inspection-replacement'); };
        let failure: unknown;
        switch (scenario) {
          case 'enoent': failure = Object.assign(new Error('synthetic'), { code: 'ENOENT' }); break;
          case 'error': failure = new Error('synthetic'); break;
          case 'string': failure = 'synthetic'; break;
          case 'getter': failure = Object.defineProperty({}, 'code', { get: inspect }); break;
          case 'proxy': failure = new Proxy({}, { get: inspect, getPrototypeOf: inspect }); break;
          case 'revoked': {
            const revoked = Proxy.revocable({}, {});
            revoked.revoke();
            failure = revoked.proxy;
            break;
          }
          case 'null': failure = null; break;
          default: assert.fail('Unknown fixture scenario');
        }
        try {
          Reflect.defineProperty(fs, 'readdir', { configurable: true, writable: true,
            value: async (...args: unknown[]) => {
              enumerations.push(args);
              const entries = [FILE];
              if (stage === 'processing') {
                // Defensive in-process result fault, not a claim about native arrays.
                Object.defineProperty(entries, 'filter', { value() { throw failure; } });
              }
              return entries;
            },
          });
          Reflect.defineProperty(fs, 'copyFile', { configurable: true, writable: true,
            value: async (...args: unknown[]) => {
              copies.push(args);
              // Never create a module or reach dynamic import.
              throw new Error('synthetic-copy-failure');
            },
          });
          Reflect.defineProperty(fs, 'rm', { configurable: true, writable: true,
            value: async (...args: unknown[]) => { removals.push(args); throw failure; },
          });
          syncBuiltinESMExports();
          let caught: unknown;
          let rejected = false;
          try { await loadPlugins(root); }
          catch (error) { rejected = true; caught = error; }
          // Validate outside production catches: swallowed stub assertions cannot pass.
          assert.deepEqual(enumerations, [[root]]);
          if (stage === 'processing') {
            assert.deepEqual(copies, []);
            assert.deepEqual(removals, []);
          } else {
            assert.equal(copies.length, 1);
            assert.equal(removals.length, 1);
            const copy = copies[0]!;
            assert.equal(copy.length, 2);
            assert.equal(copy[0], join(root, FILE));
            assert.equal(typeof copy[1], 'string');
            assert.ok(typeof copy[1] === 'string');
            assert.equal(dirname(copy[1]), root);
            assert.match(basename(copy[1]), /^\.mcp-loader-\d+-synthetic\.mcp-server\.js\.tmp\.mjs$/);
            assert.deepEqual(removals[0], [copy[1], { force: true }]);
          }
          assert.deepEqual(readdirSync(root), []);
          assert.equal(rejected, true, 'later failures must not become empty success');
          assert.equal(Object.is(caught, failure), true);
          assert.equal(inspections, 0);
        } finally {
          Object.assign(fs, original);
          syncBuiltinESMExports();
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }

  it('preserves actual missing-directory and empty-directory compatibility', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wp00-enumeration-'));
    try {
      assert.deepEqual(await loadPlugins(join(root, 'missing')), EMPTY);
      assert.deepEqual(await loadPlugins(root), EMPTY);
      assert.deepEqual(readdirSync(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rethrows the exact native regular-file enumeration failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wp00-enumeration-'));
    const path = join(root, 'not-a-directory');
    writeFileSync(path, 'synthetic');
    const original = fs.readdir;
    let nativeError: unknown;
    let calls = 0;
    try {
      Reflect.defineProperty(fs, 'readdir', { configurable: true, writable: true,
        value: async (input: string) => {
          calls++;
          assert.equal(input, path);
          try { return await original(input); }
          catch (error) { nativeError = error; throw error; }
        },
      });
      syncBuiltinESMExports();
      let caught: unknown;
      let rejected = false;
      try { await loadPlugins(path); }
      catch (error) { caught = error; rejected = true; }
      assert.equal(calls, 1);
      assert.equal(rejected, true);
      assert.notEqual(nativeError, undefined);
      assert.equal(Object.is(caught, nativeError), true);
      assert.equal(typeof nativeError, 'object');
      assert.ok(nativeError !== null && typeof nativeError === 'object' && 'code' in nativeError);
      assert.equal(nativeError.code, 'ENOTDIR');
    } finally {
      fs.readdir = original;
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Plugin enumeration error shapes (not filesystem provenance)', { concurrency: false }, () => {
  const rejectedShapes = [
    'ordinary', 'prototype-imitation', 'inherited-data', 'inherited-getter',
    'own-getter-return', 'own-getter-throw', 'native-proxy', 'ordinary-proxy',
    'revoked', 'null', 'string', 'coercion-code', 'different-code',
  ];
  for (const scenario of [...rejectedShapes, 'native-own', 'cross-realm']) {
    it('classifies enumeration shape ' + scenario + ' without observable inspection', async () => {
      const root = mkdtempSync(join(tmpdir(), 'wp00-enumeration-shape-'));
      const original = { readdir: fs.readdir, copyFile: fs.copyFile, rm: fs.rm };
      const enumerations: unknown[][] = [];
      let copies = 0;
      let removals = 0;
      let inspections = 0;
      const inspect = () => { inspections++; throw new Error('inspection-replacement'); };
      const native = () => Object.assign(new Error('synthetic'), { code: 'ENOENT' });
      let failure: unknown;
      switch (scenario) {
        case 'ordinary': failure = { code: 'ENOENT' }; break;
        case 'prototype-imitation':
          failure = Object.assign(Object.create(Error.prototype), { code: 'ENOENT' });
          break;
        case 'inherited-data':
        case 'inherited-getter': {
          const prototype = Object.create(Error.prototype);
          Object.defineProperty(prototype, 'code', scenario === 'inherited-data'
            ? { value: 'ENOENT' }
            : { get() { inspections++; return 'ENOENT'; } });
          failure = Object.setPrototypeOf(new Error('synthetic'), prototype);
          break;
        }
        case 'own-getter-return':
          failure = Object.defineProperty(new Error('synthetic'), 'code',
            { get() { inspections++; return 'ENOENT'; } });
          break;
        case 'own-getter-throw':
          failure = Object.defineProperty(new Error('synthetic'), 'code', { get: inspect });
          break;
        case 'native-proxy':
        case 'ordinary-proxy':
          failure = new Proxy(scenario === 'native-proxy' ? native() : {}, {
            get: inspect, getPrototypeOf: inspect, getOwnPropertyDescriptor: inspect, has: inspect,
          });
          break;
        case 'revoked': {
          const revoked = Proxy.revocable(native(), {});
          revoked.revoke();
          failure = revoked.proxy;
          break;
        }
        case 'null': failure = null; break;
        case 'string': failure = 'ENOENT'; break;
        case 'coercion-code':
          failure = Object.assign(new Error('synthetic'), {
            code: { toString: inspect, valueOf: inspect, [Symbol.toPrimitive]: inspect },
          });
          break;
        case 'different-code':
          failure = Object.assign(new Error('synthetic'), { code: 'EACCES' });
          break;
        case 'native-own': failure = native(); break;
        case 'cross-realm':
          // Fixed fixture expression only; never evaluate candidate plugin source.
          failure = runInNewContext("Object.assign(new Error('synthetic'), { code: 'ENOENT' })");
          break;
        default: assert.fail('Unknown fixture scenario');
      }
      try {
        Reflect.defineProperty(fs, 'readdir', { configurable: true, writable: true,
          value: async (...args: unknown[]) => { enumerations.push(args); throw failure; },
        });
        Reflect.defineProperty(fs, 'copyFile', { configurable: true, writable: true,
          value: async () => { copies++; throw new Error('unexpected-copy'); },
        });
        Reflect.defineProperty(fs, 'rm', { configurable: true, writable: true,
          value: async () => { removals++; throw new Error('unexpected-cleanup'); },
        });
        syncBuiltinESMExports();
        let caught: unknown;
        let result: unknown;
        let rejected = false;
        try { result = await loadPlugins(root); }
        catch (error) { rejected = true; caught = error; }
        assert.deepEqual(enumerations, [[root]]);
        assert.equal(copies, 0);
        assert.equal(removals, 0);
        assert.deepEqual(readdirSync(root), []);
        if (rejectedShapes.includes(scenario)) {
          assert.equal(rejected, true, 'unsupported shapes must not become empty success');
          assert.equal(Object.is(caught, failure), true);
        } else {
          // Constructed native errors remain accepted: shape is not provenance.
          assert.equal(rejected, false);
          assert.deepEqual(result, EMPTY);
        }
        assert.equal(inspections, 0);
      } finally {
        Object.assign(fs, original);
        syncBuiltinESMExports();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
