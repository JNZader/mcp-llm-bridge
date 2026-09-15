import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import ts from 'typescript';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { createInventoryCompilerHost, INVENTORY_LIMITS, VIRTUAL_ROOT } from '../contracts/scanner/typescript-modules.mjs';

const policy = 'nodenext-explicit-v1';
function record(path: string, text: string | Buffer) {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return { path, mode: 0o100644, length: BigInt(bytes.length),
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
function rejected(records: unknown, code?: string) {
  const result = createInventoryCompilerHost(records, policy);
  assert.equal(result.status, 'rejected');
  assert.equal(result.host, undefined);
  assert.equal(result.rootNames, undefined);
  if (code) assert.equal(result.diagnostics[0].code, code);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
}

describe('Immutable inventory-only TypeScript CompilerHost', () => {
  it('requires explicit policy and exposes only detached immutable identities', () => {
    const input = record('src/main.ts', "import './other.js';");
    const records = [input, record('package.json', '{"type":"module"}'), record('tsconfig.json', '{/* config text only */}')];
    assert.equal(createInventoryCompilerHost(records).status, 'unavailable');
    assert.equal(createInventoryCompilerHost(records, 'bundler').status, 'unavailable');
    const result = createInventoryCompilerHost(records, policy);
    assert.equal(result.status, 'available');
    assert.equal(result.graph, 'not_evaluated');
    assert.equal(result.admission, 'not_evaluated');
    assert.deepEqual(result.rootNames, [`${VIRTUAL_ROOT}/src/main.ts`]);
    const original = result.host.readFile('src/main.ts');
    input.bytes.fill(0); input.path = 'changed.ts'; records.length = 0;
    assert.equal(result.host.readFile('src/main.ts'), original);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.host));
    assert.ok(Object.isFrozen(result.identities) && result.identities.every(Object.isFrozen));
    assert.throws(() => { result.identities[0].path = 'changed'; }, TypeError);
  });

  it('uses no ts.sys fallback even for absent libraries, packages, and directories', () => {
    const originalRead = ts.sys.readFile, originalExists = ts.sys.fileExists;
    const trap = () => { throw new Error('ambient filesystem access'); };
    ts.sys.readFile = trap; ts.sys.fileExists = trap;
    try {
      const result = createInventoryCompilerHost([record('src/main.ts', 'export const x = 1;')], policy);
      assert.equal(result.status, 'available');
      const host = result.host;
      for (const name of ['node_modules/typescript/lib/lib.d.ts', '/etc/secret-canary', '../outside.ts', 'package.json']) {
        assert.equal(host.readFile(name), undefined);
        assert.equal(host.fileExists(name), false);
        assert.equal(host.getSourceFile(name, ts.ScriptTarget.ESNext), undefined);
      }
      assert.equal(host.fileExists('src/main.ts'), true);
      assert.equal(host.fileExists('src/Main.ts'), false);
      assert.deepEqual(host.getDirectories(VIRTUAL_ROOT), ['src']);
      assert.equal(host.directoryExists(`${VIRTUAL_ROOT}/src`), true);
      assert.equal(host.directoryExists('/'), false);
      assert.equal(host.getSourceFile('src/main.ts', ts.ScriptTarget.ESNext).statements.length, 1);
      assert.throws(() => host.writeFile('x', 'content'), /write_forbidden/);
      assert.throws(() => host.createDirectory('x'), /write_forbidden/);
      assert.throws(() => host.readDirectory(VIRTUAL_ROOT), /directory_glob_unavailable/);
      assert.deepEqual(host.resolveModuleNameLiterals([{ text: 'node:fs' }]), [{ resolvedModule: undefined }]);
      assert.deepEqual(host.resolveTypeReferenceDirectiveReferences(['node']), [{ resolvedTypeReferenceDirective: undefined }]);
    } finally { ts.sys.readFile = originalRead; ts.sys.fileExists = originalExists; }
  });

  it('returns fresh real ASTs for all eight extensions without sharing mutable trees', () => {
    const inputs = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'].map((extension) =>
      record(`src/file.${extension}`, ['tsx', 'jsx'].includes(extension) ? 'const x = <div />;' : 'export const x = 1;'));
    const { host, rootNames } = createInventoryCompilerHost(inputs, policy);
    for (const name of rootNames) {
      const first = host.getSourceFile(name, ts.ScriptTarget.ESNext);
      assert.equal(first.parseDiagnostics.length, 0);
      first.text = 'mutated';
      const second = host.getSourceFileByPath(name, name, ts.ScriptTarget.ESNext);
      assert.notEqual(first, second);
      assert.notEqual(second.text, 'mutated');
    }
  });

  it('validates every record, including unused configuration, and fails without a partial host', () => {
    const source = record('src/main.ts', 'export {};');
    const config = record('package.json', '{"type":"module"}');
    rejected([source, { ...config, sha256: '0'.repeat(64) }], 'identity_mismatch');
    rejected([source, source]);
    rejected([{ ...source, path: '../outside.ts' }]);
    rejected([{ ...source, mode: 0o120000 }], 'invalid_inventory');
    rejected([{ ...source, targetPath: 'target.ts' }], 'invalid_inventory');
    rejected([{ ...config, length: 1n }], 'identity_mismatch');
    rejected([source, record('unused.json', Buffer.from([255]))], 'invalid_utf8');
    rejected([source, record('broken.ts', 'const secret-canary = (')], 'invalid_source');
  });

  it('rejects aggregate resource excess without increasing syntax limits', () => {
    rejected(Array(INVENTORY_LIMITS.records + 1).fill(null), 'resource_limit');
    const inputs = Array.from({ length: 9 }, (_, index) => record(`data/${index}.txt`, ' '.repeat(1_048_576)));
    rejected(inputs, 'resource_limit');
    rejected([record('large.ts', ' '.repeat(1_048_577))], 'resource_limit');
  });
});
