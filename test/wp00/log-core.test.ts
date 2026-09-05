import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { childLogger, createLogger } from '../../src/core/logger.js';

const CANARY = 'logger-prompt-response-credential-canary';

function capturedLogger(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const destination = {
    write(line: string) {
      lines.push(line);
    },
  };

  return {
    lines,
    logger: createLogger({ level: 'trace', pretty: false }, destination),
  };
}

function parsedLine(lines: string[]): Record<string, unknown> {
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]!);
}

describe('LOG-CORE', () => {
  it('writes structured diagnostics to the configured destination without payload canaries', () => {
    const { lines, logger } = capturedLogger();

    logger.info({
      prompt: CANARY,
      response: CANARY,
      credential: CANARY,
      nested: { token: CANARY },
      requestId: 'request-1',
    }, 'request completed');

    const entry = parsedLine(lines);
    assert.equal(JSON.stringify(entry).includes(CANARY), false);
    assert.equal(entry.requestId, 'request-1');
    assert.equal(entry.msg, 'request completed');
  });

  it('redacts inherited child bindings while retaining non-sensitive child metadata', () => {
    const { lines, logger } = capturedLogger();
    const child = childLogger({ credential: CANARY, subsystem: 'mcp' }, logger);

    child.warn({ content: CANARY, operation: 'tool-call' }, 'child event');

    const entry = parsedLine(lines);
    assert.equal(JSON.stringify(entry).includes(CANARY), false);
    assert.equal(entry.subsystem, 'mcp');
    assert.equal(entry.operation, 'tool-call');
  });

  it('keeps redaction on directly created Pino child loggers', () => {
    const { lines, logger } = capturedLogger();

    logger.child({ authorization: CANARY, component: 'http' })
      .error({ error: CANARY, event: 'request_failed' }, 'request failed');

    const entry = parsedLine(lines);
    assert.equal(JSON.stringify(entry).includes(CANARY), false);
    assert.equal(entry.component, 'http');
    assert.equal(entry.event, 'request_failed');
  });

  it('MCP-SRV-LOG-04 keeps default logger output on stderr and redacts canaries', () => {
    const loggerModule = new URL('../../src/core/logger.ts', import.meta.url).href;
    const script = `
      import { createLogger, logger } from ${JSON.stringify(loggerModule)};
      const canary = ${JSON.stringify(CANARY)};
      const created = createLogger();
      created.info({ prompt: canary, requestId: 'created' }, 'created logger');
      logger.info({ credential: canary, requestId: 'exported' }, 'exported logger');
      await new Promise((resolve, reject) => created.flush((error) => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => logger.flush((error) => error ? reject(error) : resolve()));
    `;
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      script,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(CANARY), false);
    const entries = result.stderr.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry: { requestId: string }) => entry.requestId), ['created', 'exported']);
  });
});
