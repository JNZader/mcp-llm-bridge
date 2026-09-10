import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

const execute = promisify(execFile);
const child = fileURLToPath(new URL('./fixtures/log-setup-merge-child.ts', import.meta.url));
interface Report {
  code?: number;
  escaped: boolean;
  inspections: number;
  helperIdentity: boolean;
  removedCwd?: string;
  out: string[];
  err: string[];
}
async function run(kind: string, scenario: string): Promise<Report> {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wp00-setup-merge-'));
  try {
    const marker = randomUUID();
    writeFileSync(join(root, 'fixture-marker'), marker, { mode: 0o600 });
    const { stdout, stderr } = await execute(process.execPath,
      ['--import', 'tsx', child, root, marker, kind, scenario], {
        env: { HOME: root, NODE_ENV: 'production' },
        timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8',
      });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    // Only the isolated verifier runs this fixture; await child termination first.
    rmSync(root, { recursive: true, force: true });
  }
}
describe('Setup merge failure boundaries', { concurrency: false }, () => {
  for (const kind of ['claude', 'gateway']) {
    for (const scenario of ['directory', 'missing-parent', 'backup-collision', 'error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'null']) {
      it(kind + ' contains merge failure: ' + scenario, async () => {
        const report = await run(kind, scenario);
        assert.equal(report.escaped, false);
        assert.equal(report.code, 1);
        assert.equal(report.inspections, 0);
        assert.equal(report.helperIdentity, true);
        assert.deepEqual(report.err, [kind === 'claude'
          ? '[setup-claude-code] Unable to update Claude Code configuration.\n'
          : '[setup-gateway] Unable to update Claude Code settings.\n']);
        assert.equal(report.out.join('').includes('Wrote '), false);
        assert.equal(report.out.join('').includes('Backed up previous'), false);
        assert.equal([...report.out, ...report.err].join('').includes('synthetic-merge-error-canary'), false);
      });
    }
    it(kind + ' preserves successful merge and backup', async () => {
      const report = await run(kind, 'success');
      assert.equal(report.code, 0);
      assert.equal(report.escaped, false);
      assert.deepEqual(report.err, []);
      assert.ok(report.out.join('').includes('Wrote '));
      assert.ok(report.out.join('').includes('Backed up previous'));
    });
  }
  it('gateway dry run avoids even an unusable destination', async () => {
    const report = await run('gateway', 'dry');
    assert.equal(report.code, 0);
    assert.equal(report.escaped, false);
    assert.deepEqual(report.err, []);
    assert.ok(report.out.join('').includes('Dry run (default): no files were modified.'));
  });
  it('gateway project apply contains a removed working-directory resolution failure', async () => {
    const report = await run('gateway', 'removed-cwd');
    assert.equal(report.escaped, false);
    assert.equal(report.code, 1);
    assert.deepEqual(report.err, ['[setup-gateway] Unable to update Claude Code settings.\n']);
    assert.ok(report.removedCwd);
    assert.equal(report.err.join('').includes(report.removedCwd), false);
    assert.equal(report.err.join('').includes('Error:'), false);
    assert.equal(report.err.join('').includes('\n    at '), false);
  });
});
