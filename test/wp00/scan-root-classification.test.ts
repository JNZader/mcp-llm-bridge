import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { classifyExecutionRoots } from '../contracts/scanner/root-integration.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { collectRootInventory } from '../contracts/scanner/root-inventory.mjs';

function record(path: string, source = '', mode = 0o100644) {
  const bytes = Buffer.from(source);
  return { path, mode, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
const classified = (records: unknown[]) => {
  const result = classifyExecutionRoots(records);
  assert.equal(result.status, 'classified');
  assert.equal(Object.hasOwn(result, 'edges'), false);
  assert.equal(Object.hasOwn(result, 'bindingHash'), false);
  return result;
};

describe('SCAN-ROOT aggregate classification, not parsing or admission', () => {
  it('SCAN-ROOT-15 classifies formats once with deterministic coverage and TS/JS precedence over shebang/mode', () => {
    const records = [record('run.js', '#!/bin/sh\necho bad', 0o100755), record('package.json', '{}'),
      record('.github/workflows/check.yml'), record('.devcontainer/Dockerfile'), record('docker-compose.test.yml'),
      record('.devcontainer/devcontainer.json'), record('tsconfig.json'), record('lib/run.sh'), record('README.md')];
    const result = classified(records);
    assert.deepEqual(result, classified([...records].reverse()));
    assert.deepEqual(result.coverage, { observed: 9, execution: 8, passive: 1 });
    assert.equal(result.roots.find((root: { path: string }) => root.path === 'run.js').disposition, 'awaiting_ast');
    assert.equal(new Set(result.roots.map((root: { path: string }) => root.path)).size, records.length);
  });
  it('retains generated provenance, unknown formats and interpreter conflicts instead of exclusions', () => {
    const result = classified([record('docs/assets/app.js'), record('docs/index.html'), record('dist-old/index.js'),
      record('run.sh', '#!/usr/bin/env node\n'), record('runner', '#!/usr/bin/env -S python -u\n'), record('opaque.dat'),
      record('binary.png', 'bytes', 0o100755)]);
    assert.equal(result.coverage.execution, 7);
    assert.ok(result.roots.find((root: { path: string }) => root.path === 'docs/index.html').obligations.includes('generated_provenance'));
    const conflict = result.roots.find((root: { path: string }) => root.path === 'run.sh');
    assert.equal(conflict.disposition, 'unresolved');
    assert.ok(conflict.obligations.includes('interpreter_conflict'));
  });
  it('preserves link-byte authority separately from final target identity and never parses link contents', () => {
    const target = record('target.js', 'console.log(1)');
    const link = { ...record('run.sh', 'target.js', 0o120000), targetPath: 'target.js' };
    const root = classified([target, link]).roots[0];
    assert.equal(root.format, 'symlink');
    assert.equal(root.disposition, 'awaiting_link');
    assert.equal(root.sha256, link.sha256);
    assert.equal(root.target.sha256, target.sha256);
    assert.equal(root.target.format, 'typescript_javascript');
  });
  it('SCAN-ROOT-16 rejects invalid identities, duplicates and inconsistent links without partial descriptors', () => {
    const good = record('a.ts', 'secret-canary');
    for (const records of [[good, good], [{ ...good, path: '../escape' }], [{ ...good, mode: 0o100600 }],
      [{ ...good, length: 999n }], [{ ...good, sha256: 'a'.repeat(64) }], [{ ...good, targetPath: 'a.ts' }],
      [{ ...record('link', '../escape', 0o120000), targetPath: 'a.ts' }, good],
      [{ ...record('link', 'a.ts', 0o120000), targetPath: 'wrong.ts' }, good]]) {
      const result = classifyExecutionRoots(records);
      assert.equal(result.status, 'rejected');
      assert.deepEqual(result.roots, []);
      assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
    }
  });
  it('classifies actual repository representatives without claiming parser or whole-repository success', () => {
    const paths = ['package.json', 'tsup.config.ts', 'dashboard/vite.config.ts', '.github/workflows/ci.yml', 'Dockerfile', 'docker-compose.yml'];
    const records = paths.map((path) => record(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')));
    const result = classified(records);
    assert.equal(result.coverage.observed, paths.length);
    assert.ok(result.roots.some((root: { disposition: string }) => root.disposition === 'awaiting_ast'));
    assert.ok(result.roots.some((root: { format: string }) => root.format === 'package_json'));
  });
  it('composes real Git/filesystem inventory with classification in a disposable repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp00-classify-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      writeFileSync(join(root, 'run.sh'), '#!/bin/sh\necho ok\n');
      writeFileSync(join(root, 'README.md'), 'passive');
      symlinkSync('run.sh', join(root, 'launch'));
      execFileSync('git', ['add', 'run.sh', 'README.md', 'launch'], { cwd: root });
      const observed = collectRootInventory(root);
      const result = classified(observed.records);
      assert.equal(result.coverage.observed, observed.records.length);
      assert.equal(result.roots.find((item: { path: string }) => item.path === 'launch').target.path, 'run.sh');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
