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
const childPath = fileURLToPath(new URL('./fixtures/log-vault-refresh-child.ts', import.meta.url));
const loaderPath = fileURLToPath(new URL('../setup/inject-require.mjs', import.meta.url));
const CANARY = 'synthetic-vault-private-canary';
const REFRESH_WARNING = '[claude-oauth] Token refresh not yet implemented. Consider re-authenticating with Claude CLI.';

interface Report {
  escaped: boolean;
  inspections: number;
  injected: number;
  preserved: boolean;
  synced: boolean;
  destroyed: boolean;
  raw: string[];
  output: string[];
}

async function run(scenario: string): Promise<Report> {
  // Run only in the isolated offline verification container, never on the host.
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wp00-vault-refresh-'));
  try {
    const marker = randomUUID();
    writeFileSync(join(root, 'fixture-marker'), marker, { mode: 0o600 });
    const { stdout, stderr } = await execute(process.execPath,
      ['--import', 'tsx', '--import', loaderPath, childPath, root, marker, scenario], {
        env: { HOME: root, NODE_ENV: 'production' },
        timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8',
      });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    // Await process termination before removing its exclusively owned HOME.
    rmSync(root, { recursive: true, force: true });
  }
}

describe('LOG-OPERATIONS Vault refresh fallback', { concurrency: false }, () => {
  for (const scenario of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
    it('contains defensive internal refresh failure: ' + scenario, async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.injected, 1);
      assert.equal(report.preserved, true);
      assert.equal(report.synced, true);
      assert.equal(report.destroyed, true);
      assert.equal(report.inspections, 0);
      const publicOutput = report.raw.join('') + report.output.join('');
      assert.equal(publicOutput.includes(CANARY), false);
      assert.equal(publicOutput.includes('wp00-vault-refresh-'), false);
      assert.deepEqual(report.raw, []);
      assert.equal(report.output.length, 1);
      const entry: Record<string, unknown> = JSON.parse(report.output[0]!);
      const { pid, hostname, time, ...event } = entry;
      assert.equal(typeof pid, 'number');
      assert.equal(typeof hostname, 'string');
      assert.equal(typeof time, 'number');
      assert.deepEqual(event, {
        level: 40, outcome: 'failed', code: 'INTERNAL_ERROR',
        msg: '[vault] Token refresh failed, using existing token:',
      });
    });
  }

  for (const scenario of ['missing', 'no-refresh', 'fresh', 'stub']) {
    it('preserves actual reader and sync behavior: ' + scenario, async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.injected, 0);
      assert.equal(report.preserved, true);
      assert.equal(report.synced, scenario !== 'missing');
      assert.equal(report.destroyed, true);
      assert.equal(report.inspections, 0);
      assert.deepEqual(report.output, []);
      assert.deepEqual(report.raw, scenario === 'stub' ? [REFRESH_WARNING + '\n'] : []);
    });
  }
});
