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
const child = fileURLToPath(new URL('./fixtures/log-setup-claude-child.ts', import.meta.url));
const CANARY = 'synthetic-setup-private-canary';
interface Report {
  code?: number;
  escaped: boolean;
  inspections: number;
  calls: number;
  merged: boolean;
  backup: boolean;
  out: string[];
  err: string[];
  warn: string[];
}

async function run(scenario: string): Promise<Report> {
  // Isolated offline verification only; the child receives no ambient credentials.
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wp00-setup-claude-'));
  try {
    const marker = randomUUID();
    writeFileSync(join(root, 'fixture-marker'), marker, { mode: 0o600 });
    const { stdout, stderr } = await execute(process.execPath,
      ['--import', 'tsx', child, root, marker, scenario], {
        env: { HOME: root, NODE_ENV: 'production' },
        timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8',
      });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    // execFile has settled and the child is terminated before removing its HOME.
    rmSync(root, { recursive: true, force: true });
  }
}

describe('LOG-OPERATIONS Claude setup diagnostics', { concurrency: false }, () => {
  for (const scenario of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'null']) {
    it('keeps fallback usable after ' + scenario, async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.code, 0);
      assert.equal(report.calls, 2);
      assert.equal(report.inspections, 0);
      assert.equal(report.merged, true);
      assert.equal(report.backup, true);
      assert.deepEqual(report.err, []);
      assert.deepEqual(report.warn, ['[setup-claude-code] "claude mcp add" failed. Falling back to direct config merge.\n']);
      assert.equal([...report.out, ...report.err, ...report.warn].join('').includes(CANARY), false);
    });
  }
  for (const scenario of ['scope-separated', 'scope-equals', 'scope-missing']) {
    it('prints finite validation instructions for ' + scenario, async () => {
      const report = await run(scenario);
      assert.equal(report.code, 1);
      assert.equal(report.escaped, false);
      assert.equal(report.calls, 0);
      assert.equal(report.merged, false);
      assert.equal(report.backup, false);
      assert.deepEqual(report.out, []);
      assert.deepEqual(report.warn, []);
      assert.deepEqual(report.err, ['[setup-claude-code] Invalid --scope value. Expected "user" or "project".\n']);
    });
  }
  for (const scenario of ['success', 'project', 'project-equals', 'absent', 'build-missing']) {
    it('preserves registration and instructions: ' + scenario, async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.code, scenario === 'build-missing' ? 1 : 0);
      assert.equal(report.calls, scenario === 'build-missing' ? 0 : scenario === 'absent' ? 1 : 2);
      assert.equal(report.merged, scenario === 'absent');
      assert.equal(report.backup, scenario === 'absent');
      assert.deepEqual(report.warn, []);
      if (scenario === 'build-missing') {
        assert.deepEqual(report.out, []);
        assert.equal(report.err.length, 1);
        assert.ok(report.err[0]?.includes('Run "npm run build" first'));
        assert.ok(report.err[0]?.includes('npx tsx src/index.ts'));
      } else {
        assert.deepEqual(report.err, []);
        assert.ok(report.out.join('').includes('Verify with: claude mcp list'));
        assert.ok(report.out.join('').includes('Scope: ' + (scenario.startsWith('project') ? 'project' : 'user')));
      }
    });
  }
});
