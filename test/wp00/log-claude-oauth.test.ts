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
const CANARY = 'synthetic-oauth-private-canary';
const childPath = fileURLToPath(new URL('./fixtures/log-claude-oauth-child.ts', import.meta.url));

interface Report {
  result?: boolean;
  escaped: boolean;
  inspections: number;
  written: Record<string, unknown> | null;
  directoryMode: number;
  raw: string[];
  output: string[];
}

async function run(scenario: string): Promise<Report> {
  // This test is executed only by the isolated offline verification worker.
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wp00-oauth-canary-'));
  const marker = randomUUID();
  try {
    writeFileSync(join(root, 'fixture-marker'), marker, { mode: 0o600 });
    // Deliberately no process.env spread: no tokens, NODE_OPTIONS or other
    // inherited settings reach the child. Absolute executable needs no PATH.
    const { stdout, stderr } = await execute(process.execPath,
      ['--import', 'tsx', childPath, root, marker, scenario], {
        env: { HOME: root, NODE_ENV: 'production' },
        timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8',
      });
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    // execFile completion/rejection follows child termination; never remove
    // the owned HOME while an importer or write could still be running.
    rmSync(root, { recursive: true, force: true });
  }
}

describe('LOG-OPERATIONS isolated OAuth sync errors', { concurrency: false }, () => {
  for (const scenario of ['filesystem', 'error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
    it('contains ' + scenario + ' without escaping or inspecting the exception', async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.result, false);
      assert.equal(report.inspections, 0);
      assert.equal(report.raw.join('').includes(CANARY), false);
      assert.equal(report.raw.join('').includes('wp00-oauth-canary-'), false);
      assert.deepEqual(report.raw, []);
      assert.equal(report.output.length, 1);
      assert.equal(report.output.join('').includes(CANARY), false);
      assert.equal(report.output.join('').includes('wp00-oauth-canary-'), false);
      const entry: Record<string, unknown> = JSON.parse(report.output[0]!);
      const { pid, hostname, time, ...event } = entry;
      assert.equal(typeof pid, 'number');
      assert.equal(typeof hostname, 'string');
      assert.equal(typeof time, 'number');
      assert.deepEqual(event, {
        level: 50, msg: '[claude-oauth] Failed to sync to opencode auth:',
        outcome: 'failed', code: 'INTERNAL_ERROR',
      });
      assert.equal(report.written, null);
    });
  }

  for (const scenario of ['minimal', 'full']) {
    it('preserves ' + scenario + ' synthetic credential writes without logs', async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.result, true);
      assert.equal(report.directoryMode, 0o700);
      assert.deepEqual(report.raw, []);
      assert.deepEqual(report.output, []);
      assert.ok(report.written);
      assert.equal(typeof report.written.updated_at, 'string');
      assert.ok(Number.isFinite(Date.parse(String(report.written.updated_at))));
      assert.deepEqual(report.written, {
        access_token: CANARY, provider: 'claude-cli', updated_at: report.written.updated_at,
        ...(scenario === 'full' ? { refresh_token: 'synthetic-refresh-canary', expires_at: 1900000000000 } : {}),
      });
    });
  }
});
