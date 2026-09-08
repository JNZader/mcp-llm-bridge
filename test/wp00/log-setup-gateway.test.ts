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
const child = fileURLToPath(new URL('./fixtures/log-setup-gateway-child.ts', import.meta.url));
const CANARY = 'synthetic-gateway-error-canary';
interface Report {
  code?: number;
  escaped: boolean;
  inspections: number;
  written: boolean;
  backup: boolean;
  out: string[];
  err: string[];
}

async function run(scenario: string): Promise<Report> {
  // Executed only by the isolated offline verifier, not against host settings.
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wp00-setup-gateway-'));
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
    // Awaited child termination precedes deletion of its exclusively owned HOME.
    rmSync(root, { recursive: true, force: true });
  }
}

describe('LOG-OPERATIONS gateway setup diagnostics', { concurrency: false }, () => {
  const failures = ['scope-separated', 'scope-equals', 'scope-missing', 'port-text', 'port-zero', 'port-high',
    'error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'null'];
  for (const scenario of failures) {
    it('contains ' + scenario + ' without writes or exception inspection', async () => {
      const report = await run(scenario);
      assert.equal(report.escaped, false);
      assert.equal(report.code, 1);
      assert.equal(report.inspections, 0);
      assert.equal(report.written, false);
      assert.equal(report.backup, false);
      assert.deepEqual(report.out, []);
      assert.equal(report.err.join('').includes(CANARY), false);
      assert.deepEqual(report.err, [scenario.startsWith('scope-')
        ? '[setup-gateway] Invalid --scope value. Expected "user" or "project".\n'
        : '[setup-gateway] LLM_GATEWAY_PORT must be a valid port number (1-65535).\n']);
    });
  }
  for (const scenario of ['default', 'prefix', 'token', 'apply-user', 'apply-project', 'apply-empty']) {
    it('preserves intentional setup output and settings: ' + scenario, async () => {
      const report = await run(scenario);
      assert.equal(report.code, 0);
      assert.equal(report.escaped, false);
      assert.equal(report.inspections, 0);
      assert.deepEqual(report.err, []);
      assert.equal(report.written, scenario.startsWith('apply-'));
      assert.equal(report.backup, scenario === 'apply-user' || scenario === 'apply-project');
      const output = report.out.join('');
      assert.ok(output.includes('CAVEAT:'));
      assert.ok(output.includes('llm-bridge --http'));
      assert.ok(output.includes('llm-bridge serve'));
      assert.equal(output.includes('synthetic-intentional-gateway-token'), scenario !== 'default' && scenario !== 'apply-empty');
      if (scenario === 'default' || scenario === 'apply-empty') assert.ok(output.includes('WITHOUT auth'));
      if (scenario === 'prefix') assert.ok(output.includes('Gateway port: 4321'));
      if (!scenario.startsWith('apply-')) assert.ok(output.includes('Dry run (default): no files were modified.'));
    });
  }
});
