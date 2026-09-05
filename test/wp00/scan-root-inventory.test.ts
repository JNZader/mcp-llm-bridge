import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { collectRootInventory, decodeGitInventory } from '../contracts/scanner/root-inventory.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { decodePathsBin } from '../contracts/outward-scanner.mjs';

interface RecordEntry { path: string; mode: number; length: bigint; sha256: string; bytes: Buffer; executable: boolean; targetPath?: string }
function repository(run: (root: string, git: (...args: string[]) => Buffer) => void) {
  const root = mkdtempSync(join(tmpdir(), 'wp00-inventory-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git('init', '--quiet'); run(root, git); } finally { rmSync(root, { recursive: true, force: true }); }
}
const reject = (run: () => unknown) => assert.throws(run, /^Error: WP00 inventory: (REJECTED|INVALID_GIT_INVENTORY)$/);
const nul = (...paths: string[]) => Buffer.from(paths.length ? `${paths.join('\0')}\0` : '');

describe('SCAN-ROOT-INVENTORY', () => {
  it('SCAN-ROOT-03 inventories tracked and untracked working bytes with exact normalized modes and deterministic binary identity', () => {
    repository((root, git) => {
      writeFileSync(join(root, 'tracked.ts'), 'old');
      git('add', 'tracked.ts');
      writeFileSync(join(root, 'tracked.ts'), 'new');
      writeFileSync(join(root, 'run.bin'), 'binary');
      chmodSync(join(root, 'run.bin'), 0o755);
      writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
      writeFileSync(join(root, 'ignored.txt'), 'not inventoried');
      writeFileSync(join(root, 'é\t\n.txt'), 'utf8');
      const result = collectRootInventory(root);
      const records: RecordEntry[] = result.records;
      assert.deepEqual(records.map((record) => record.path), ['.gitignore', 'run.bin', 'tracked.ts', 'é\t\n.txt']);
      assert.equal(records.find((record) => record.path === 'run.bin')?.mode, 0o100755);
      const tracked = records.find((record) => record.path === 'tracked.ts');
      assert.equal(tracked?.bytes.toString(), 'new');
      assert.equal(tracked?.sha256, createHash('sha256').update('new').digest('hex'));
      assert.equal(tracked?.length, 3n);
      assert.deepEqual(decodePathsBin(result.pathsBin).map((record: RecordEntry) => record.path), records.map((record) => record.path));
      assert.deepEqual(collectRootInventory(root).pathsBin, result.pathsBin);
    });
  });
  it('classifies every executable suffix, extensionless, shebang and executable mode without classifying plain text', () => {
    repository((root) => {
      const names = ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.mts', 'h.cts', 'i.sh', 'tool'];
      for (const name of names) writeFileSync(join(root, name), '');
      writeFileSync(join(root, 'shebang.txt'), '#!/bin/sh\n');
      writeFileSync(join(root, 'plain.txt'), 'plain');
      const records: RecordEntry[] = collectRootInventory(root).records;
      assert.deepEqual(records.filter((record) => record.executable).map((record) => record.path).sort(), [...names, 'shebang.txt'].sort());
    });
  });
  it('SCAN-ROOT-04 hashes link target bytes and resolves contained inventoried chains without dereferencing', () => {
    repository((root, git) => {
      mkdirSync(join(root, 'dir'));
      writeFileSync(join(root, 'target.sh'), '#!/bin/sh\n');
      symlinkSync('../target.sh', join(root, 'dir', 'alias'));
      symlinkSync('dir/alias', join(root, 'chain'));
      git('add', 'dir/alias');
      const records: RecordEntry[] = collectRootInventory(root).records;
      const link = records.find((record) => record.path === 'dir/alias');
      assert.equal(link?.mode, 0o120000);
      assert.equal(link?.length, 12n);
      assert.equal(link?.sha256, createHash('sha256').update('../target.sh').digest('hex'));
      assert.equal(link?.targetPath, 'target.sh');
      assert.equal(records.find((record) => record.path === 'chain')?.targetPath, 'target.sh');
      assert.equal(records.find((record) => record.path === 'chain')?.executable, true);
    });
  });
  it('rejects absolute, escaping, missing, ignored and cyclic link targets with content-free errors', () => {
    for (const target of ['/secret-canary', '../secret-canary', 'missing', 'ignored', 'link', 'missing/../present']) {
      repository((root) => {
        writeFileSync(join(root, '.gitignore'), 'ignored\n');
        writeFileSync(join(root, 'ignored'), 'secret-canary');
        writeFileSync(join(root, 'present'), '');
        symlinkSync(target, join(root, 'link'));
        reject(() => collectRootInventory(root));
      });
    }
  });
  it('rejects special files without blocking, tracked mode drift, missing files and symlink parents', () => {
    repository((root, git) => {
      execFileSync('mkfifo', [join(root, 'pipe')]);
      reject(() => collectRootInventory(root));
      rmSync(join(root, 'pipe'));
      writeFileSync(join(root, 'tracked'), '');
      git('add', 'tracked');
      chmodSync(join(root, 'tracked'), 0o755);
      reject(() => collectRootInventory(root));
      rmSync(join(root, 'tracked'));
      reject(() => collectRootInventory(root));
    });
    repository((root, git) => {
      mkdirSync(join(root, 'dir'));
      writeFileSync(join(root, 'dir', 'file'), '');
      git('add', 'dir/file');
      rmSync(join(root, 'dir'), { recursive: true });
      symlinkSync('/secret-canary', join(root, 'dir'));
      reject(() => collectRootInventory(root));
    });
  });
  it('rejects nested untracked special files while respecting Git-ignored files and directories', () => {
    repository((root) => {
      mkdirSync(join(root, 'nested'));
      mkdirSync(join(root, 'ignored-dir'));
      writeFileSync(join(root, '.gitignore'), 'ignored-pipe\nignored-dir/\n');
      for (const path of ['ignored-pipe', 'ignored-dir/pipe', 'nested/pipe']) execFileSync('mkfifo', [join(root, path)]);
      reject(() => collectRootInventory(root));
      rmSync(join(root, 'nested', 'pipe'));
      assert.deepEqual(collectRootInventory(root).records.map((record: RecordEntry) => record.path), ['.gitignore']);
    });
  });
  it('rejects malformed Git bytes, duplicate/traversing paths, unsupported index modes and merge stages', () => {
    const oid = 'a'.repeat(40);
    for (const paths of [Buffer.from([0xff, 0]), Buffer.from('no-nul'), nul('x', 'x'), nul('../x'), nul('a\\b')]) {
      reject(() => decodeGitInventory(paths, Buffer.alloc(0)));
    }
    for (const metadata of [`160000 ${oid} 0\tx`, `100644 ${oid} 1\tx`, `100644 ${oid} 0\ty`]) {
      reject(() => decodeGitInventory(nul('x'), nul(metadata)));
    }
    assert.deepEqual(decodeGitInventory(Buffer.alloc(0), Buffer.alloc(0)), []);
  });
});
