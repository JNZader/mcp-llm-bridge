import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const cli = fileURLToPath(new URL('../contracts/outward-scanner.mjs', import.meta.url));
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000 });
function repository(check: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'wp00-coverage-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, 'run.sh'), '#!/bin/sh\necho secret-canary\n');
    writeFileSync(join(root, 'README.md'), 'passive secret-canary');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'ignored.txt'), 'secret-canary');
    execFileSync('git', ['add', 'run.sh', 'README.md', '.gitignore'], { cwd: root });
    check(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('Coverage CLI: classification reporting only', () => {
  it('reports deterministic actual Git inventory without modifying index or tracked bytes', () => {
    repository((root) => {
      writeFileSync(join(root, 'untracked.ts'), 'const secret = "secret-canary";');
      const files = ['.git/index', 'run.sh', 'README.md', '.gitignore', 'untracked.ts'];
      const before = files.map((file) => digest(join(root, file)));
      const first = run(['coverage', '--cwd', root]);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.stderr, '');
      assert.equal(first.stdout, run(['coverage', '--cwd', root]).stdout);
      const report = JSON.parse(first.stdout);
      assert.equal(report.schema, 'wp00-root-coverage/v1');
      assert.equal(report.status, 'coverage_only');
      assert.equal(report.admission, 'not_evaluated');
      assert.equal(report.exitZeroMeaning, 'report_produced_not_security_approval');
      assert.equal(report.totals.total, 4);
      assert.equal(report.byDisposition.awaiting_ast, 1);
      assert.equal(report.descriptors.length, report.totals.total);
      assert.doesNotMatch(first.stdout, /secret-canary|ignored\.txt|"bytes"|"target"/);
      assert.deepEqual(files.map((file) => digest(join(root, file))), before);
    });
  });
  it('keeps decoder/library imports silent and free of Git subprocesses', () => {
    const expression = `await import(${JSON.stringify(new URL('../contracts/outward-scanner.mjs', import.meta.url).href)})`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', expression], { encoding: 'utf8', env: { ...process.env, PATH: '' }, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });
  it('rejects invalid command lines without reflecting supplied arguments', () => {
    for (const args of [[], ['scan'], ['coverage'], ['coverage', '--cwd', 'secret-canary', '--extra'], ['coverage', '--root', 'secret-canary']]) {
      const result = run(args);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'invalid_arguments');
      assert.doesNotMatch(result.stdout + result.stderr, /secret-canary/);
    }
  });
  it('reports non-repositories, nested roots and special files as inventory failures, never coverage success', () => {
    repository((root) => {
      mkdirSync(join(root, 'nested'));
      assert.equal(run(['coverage', '--cwd', join(root, 'nested')]).status, 1);
      execFileSync('mkfifo', [join(root, 'pipe')]);
      const result = run(['coverage', '--cwd', root]);
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).status, 'coverage_failed');
      assert.equal(JSON.parse(result.stdout).admission, 'not_evaluated');
    });
    assert.equal(run(['coverage', '--cwd', '/path-does-not-exist-secret-canary']).status, 1);
  });
  it('retains symlink obligations but omits target identity/content from CLI descriptors', () => {
    repository((root) => {
      symlinkSync('run.sh', join(root, 'launch'));
      const result = run(['coverage', '--cwd', root]);
      assert.equal(result.status, 0);
      const descriptor = JSON.parse(result.stdout).descriptors.find((item: { path: string }) => item.path === 'launch');
      assert.equal(descriptor.disposition, 'awaiting_link');
      assert.deepEqual(descriptor.obligations, ['symlink_resolution', 'target_dispatch']);
      assert.equal(Object.hasOwn(descriptor, 'target'), false);
    });
  });
});
