/**
 * CLI adapter tests — verify CLI-specific functionality.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Vault } from '../src/vault/vault.js';
import { materializeProviderHome, cleanupAllProviderHomes } from '../src/adapters/cli-home.js';
import { isCliAvailableAsync, MAX_COPILOT_ARGV_PROMPT_CHARS } from '../src/adapters/cli-utils.js';
import { extractOpenCodeError, OPENCODE_GENERATE_TIMEOUT_MS, openCodeStopReason, parseOpenCodeModelsList, parseOpenCodeOutput } from '../src/adapters/cli-opencode.js';
import { GENERATE_HTTP_TIMEOUT_MS } from '../src/core/constants.js';
import { ClaudeCliAdapter, parseClaudeCliResponse } from '../src/adapters/cli-claude.js';
import { AntigravityCliAdapter, parseAntigravityCliResponse } from '../src/adapters/cli-antigravity.js';
import { QwenCliAdapter, parseQwenCliResponse } from '../src/adapters/cli-qwen.js';
import { CodexCliAdapter } from '../src/adapters/cli-codex.js';
import { CopilotCliAdapter, buildCopilotGenerateArgs } from '../src/adapters/cli-copilot.js';
import type { GatewayConfig } from '../src/core/types.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-cli-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);

// Cleanup after all tests
process.on('exit', () => {
  cleanupAllProviderHomes();
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

// ── materializeProviderHome tests ──────────────────────────────

describe('materializeProviderHome', () => {
  beforeEach(() => {
    cleanupAllProviderHomes();
  });

  it('creates directory with correct permissions', () => {
    const files = [{ fileName: 'test.json', content: '{"key": "value"}' }];
    const result = materializeProviderHome('test-provider', files);
    
    try {
      assert.ok(existsSync(result.targetDir));
      const stat = statSync(result.targetDir);
      // Mode should be 0o700 (owner read/write/execute)
      assert.equal(stat.mode & 0o777, 0o700);
    } finally {
      result.cleanup();
    }
  });

  it('writes files with correct permissions', () => {
    const files = [{ fileName: 'auth.json', content: '{"token": "secret"}' }];
    const result = materializeProviderHome('test-provider', files);
    
    try {
      const filePath = join(result.targetDir, 'auth.json');
      assert.ok(existsSync(filePath));
      const content = readFileSync(filePath, 'utf8');
      assert.equal(content, '{"token": "secret"}');
      const stat = statSync(filePath);
      // Mode should be 0o600 (owner read/write)
      assert.equal(stat.mode & 0o777, 0o600);
    } finally {
      result.cleanup();
    }
  });

  it('caches directories for same provider/project', () => {
    const files = [{ fileName: 'auth.json', content: '{"token": "secret"}' }];
    
    const result1 = materializeProviderHome('test-provider', files);
    const dir1 = result1.targetDir;
    
    const result2 = materializeProviderHome('test-provider', files);
    const dir2 = result2.targetDir;
    
    // Same directory should be reused
    assert.equal(dir1, dir2);
    
    // Cleanup should be no-op when cached
    result2.cleanup(); // This won't actually delete since it's cached
    assert.ok(existsSync(dir1));
    
    result1.cleanup();
  });

  it('creates different directories for different projects', () => {
    const files1 = [{ fileName: 'auth.json', content: '{"project": "1"}' }];
    const files2 = [{ fileName: 'auth.json', content: '{"project": "2"}' }];
    
    const result1 = materializeProviderHome('test-provider', files1, 'project1');
    const result2 = materializeProviderHome('test-provider', files2, 'project2');
    
    // Different projects should get different directories
    assert.notEqual(result1.targetDir, result2.targetDir);
    
    result1.cleanup();
    result2.cleanup();
  });

  it('recreates directory when files change', () => {
    const files1 = [{ fileName: 'auth.json', content: '{}' }];
    const files2 = [{ fileName: 'auth.json', content: '{"new": true}' }];
    
    const result1 = materializeProviderHome('test-provider', files1);
    const dir1 = result1.targetDir;
    
    const result2 = materializeProviderHome('test-provider', files2);
    const dir2 = result2.targetDir;
    
    // Different content should create different directory
    assert.notEqual(dir1, dir2);
    
    result1.cleanup();
    result2.cleanup();
  });

  it('rejects path traversal attempts', () => {
    const files = [{ fileName: '../etc/passwd', content: 'hacked' }];
    
    assert.throws(() => {
      materializeProviderHome('test-provider', files);
    }, /Unsafe provider file path/);
  });

  it('rejects absolute paths', () => {
    const files = [{ fileName: '/etc/passwd', content: 'hacked' }];
    
    assert.throws(() => {
      materializeProviderHome('test-provider', files);
    }, /Unsafe provider file path/);
  });

  it('creates nested directories', () => {
    const files = [{ fileName: 'config/settings.json', content: '{}' }];
    const result = materializeProviderHome('test-provider', files);
    
    try {
      const filePath = join(result.targetDir, 'config', 'settings.json');
      assert.ok(existsSync(filePath));
    } finally {
      result.cleanup();
    }
  });
});

// ── CLI availability tests ─────────────────────────────────────

describe('isCliAvailableAsync', () => {
  it('returns true for non-existent command after timeout', async () => {
    // Use a command that definitely doesn't exist
    const result = await isCliAvailableAsync('this-command-does-not-exist-12345', ['--help'], 1000);
    assert.equal(result, false);
  });

  it('handles empty command gracefully', async () => {
    const result = await isCliAvailableAsync('', [], 1000);
    assert.equal(result, false);
  });
});

// ── Vault file operations tests ────────────────────────────────

describe('Vault file operations', () => {
  beforeEach(() => {
    (vault as any).db.exec('DELETE FROM files');
  });

  it('stores and retrieves files', () => {
    const id = vault.storeFile('test-provider', 'auth.json', '{"token": "secret"}');
    assert.ok(id > 0);
    
    const content = vault.getFile('test-provider', 'auth.json');
    assert.equal(content, '{"token": "secret"}');
  });

  it('stores files with project scope', () => {
    const id = vault.storeFile('test-provider', 'auth.json', '{}', 'my-project');
    assert.ok(id > 0);
    
    // Should be found with project
    const content = vault.getFile('test-provider', 'auth.json', 'my-project');
    assert.equal(content, '{}');
    
    // Should not be found without project (defaults to global)
    const globalContent = vault.getFile('test-provider', 'auth.json');
    assert.equal(globalContent, null);
  });

  it('falls back to global files', () => {
    vault.storeFile('test-provider', 'config.json', '{"global": true}');
    
    const content = vault.getFile('test-provider', 'config.json', 'some-project');
    assert.equal(content, '{"global": true}');
  });

  it('project files override global files', () => {
    vault.storeFile('test-provider', 'config.json', '{"scope": "global"}');
    vault.storeFile('test-provider', 'config.json', '{"scope": "project"}', 'my-project');
    
    const projectContent = vault.getFile('test-provider', 'config.json', 'my-project');
    assert.equal(projectContent, '{"scope": "project"}');
  });

  it('lists provider files correctly', () => {
    vault.storeFile('claude', 'auth.json', '{}');
    vault.storeFile('claude', 'settings.json', '{}');
    vault.storeFile('openai', 'key.json', '{}');
    
    const files = vault.listProviderFiles('claude');
    assert.equal(files.length, 2);
  });

  it('gets provider files for project', () => {
    vault.storeFile('claude', 'auth.json', '{"global": true}');
    vault.storeFile('claude', 'auth.json', '{"project": true}', 'my-project');
    
    const files = vault.getProviderFiles('claude', 'my-project');
    assert.equal(files.length, 1);
    assert.equal(files[0]!.content, '{"project": true}');
    assert.equal(files[0]!.project, 'my-project');
  });
});

describe('extractOpenCodeError', () => {
  const errLine = JSON.stringify({
    type: 'error',
    error: { name: 'UnknownError', data: { message: 'Unexpected server error. Check server logs for details.', ref: 'err_7d90269a' } },
  });

  it('surfaces the backend error name, message and ref from an error event', () => {
    const out = extractOpenCodeError(errLine);
    assert.ok(out, 'expected a diagnostic string');
    assert.match(out!, /UnknownError/);
    assert.match(out!, /Unexpected server error/);
    assert.match(out!, /err_7d90269a/);
  });

  it('returns undefined for a normal text stream (no error event)', () => {
    const stream = [
      JSON.stringify({ type: 'text', part: { text: 'OK' } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 3, output: 1 } } }),
    ].join('\n');
    assert.equal(extractOpenCodeError(stream), undefined);
    // and the text parser still works on the same stream
    assert.equal(parseOpenCodeOutput(stream).text, 'OK');
  });

  it('the text parser returns empty text on an error-only stream (the gap this guard covers)', () => {
    // Before the fix, this empty text + zero exit made the adapter return the
    // raw error JSON as "text"; now the adapter throws extractOpenCodeError instead.
    assert.equal(parseOpenCodeOutput(errLine).text, '');
    assert.ok(extractOpenCodeError(errLine));
  });

  it('tolerates malformed lines mixed with a real error event', () => {
    const mixed = ['not json {{{', errLine, ''].join('\n');
    assert.match(extractOpenCodeError(mixed)!, /err_7d90269a/);
  });
});

describe('OpenCode generate timeout', () => {
  it('is under Consorcio\'s 180s attempt budget and above the 120s CLI default', () => {
    assert.equal(OPENCODE_GENERATE_TIMEOUT_MS, 170_000);
    assert.ok(OPENCODE_GENERATE_TIMEOUT_MS > 120_000);
    assert.ok(OPENCODE_GENERATE_TIMEOUT_MS < 180_000);
    assert.ok(GENERATE_HTTP_TIMEOUT_MS > OPENCODE_GENERATE_TIMEOUT_MS);
    assert.ok(GENERATE_HTTP_TIMEOUT_MS < 180_000);
  });

  it('marks timed-out partial stdout as length, not a complete stop', () => {
    assert.equal(openCodeStopReason({ code: 'ETIMEDOUT', killed: true }, true), 'length');
    assert.equal(openCodeStopReason({ signal: 'SIGTERM', killed: true }, true), 'length');
    assert.equal(openCodeStopReason({ code: 1 }, true), 'stop');
    assert.equal(openCodeStopReason({ code: 'ETIMEDOUT' }, false), 'stop');
  });
});

describe('parseOpenCodeModelsList', () => {
  it('parses provider/model ids and skips noise', () => {
    const raw = [
      '[skill-registry] skipping refresh: not a project root: /',
      'opencode-go/deepseek-v4-flash',
      'opencode/big-pickle',
      '',
      'not a model',
      'opencode-go/deepseek-v4-flash',
    ].join('\n');
    const models = parseOpenCodeModelsList(raw);
    assert.deepEqual(models.map((m) => m.id), [
      'opencode-go/deepseek-v4-flash',
      'opencode/big-pickle',
    ]);
    assert.equal(models[0]!.provider, 'opencode-cli');
    assert.equal(models[0]!.name, 'Deepseek V4 Flash');
  });
});

// ── Claude CLI response parsing (error envelope guard) ─────────

describe('parseClaudeCliResponse', () => {
  it('returns the result field on a success envelope', () => {
    const envelope = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, num_turns: 1,
      result: 'the answer', stop_reason: 'end_turn',
    });
    assert.equal(parseClaudeCliResponse(envelope), 'the answer');
  });

  it('falls back to content[0].text when result is absent', () => {
    const envelope = JSON.stringify({ content: [{ type: 'text', text: 'from content' }] });
    assert.equal(parseClaudeCliResponse(envelope), 'from content');
  });

  it('throws on a real error_max_turns envelope (exit 0, no result field)', () => {
    // Captured live 2026-07-17: claude -p --max-turns 1 exits 0 but emits this
    // when the model attempts tool use on turn 1. Before the fix this raw JSON
    // was returned as the model's "answer".
    const envelope = JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 2,
      stop_reason: 'tool_use', errors: ['Reached maximum number of turns (1)'],
    });
    assert.throws(
      () => parseClaudeCliResponse(envelope),
      /error_max_turns.*Reached maximum number of turns \(1\)/,
    );
  });

  it('throws on is_error true even without an error subtype', () => {
    const envelope = JSON.stringify({ type: 'result', is_error: true });
    assert.throws(() => parseClaudeCliResponse(envelope), /subtype: unknown/);
  });

  it('throws on an error subtype even when is_error is missing', () => {
    const envelope = JSON.stringify({ type: 'result', subtype: 'error_during_execution' });
    assert.throws(() => parseClaudeCliResponse(envelope), /error_during_execution/);
  });
});

describe('ClaudeCliAdapter buildArgs', () => {
  class TestableClaudeAdapter extends ClaudeCliAdapter {
    args(model: string): string[] {
      return this.buildArgs(model);
    }
  }
  const adapter = new TestableClaudeAdapter(vault);

  it('does not put prompt or system on argv', () => {
    const prompt = 'line one\nline two "quoted"';
    const args = adapter.args('claude-sonnet-4-6');
    assert.ok(!args.includes(prompt));
    assert.ok(!args.includes(JSON.stringify(prompt)));
    assert.ok(!args.includes('--system-prompt'));
    assert.equal(args.includes('-p'), true);
  });

  it('disables all built-in tools so --max-turns 1 cannot stop on tool_use', () => {
    const args = adapter.args('claude-sonnet-4-6');
    const toolsIdx = args.indexOf('--tools');
    assert.ok(toolsIdx >= 0);
    assert.equal(args[toolsIdx + 1], '');
  });
});

// ── Antigravity / Qwen CLI error envelope guards ────────────────────

describe('parseAntigravityCliResponse', () => {
  it('returns the response field on success', () => {
    assert.equal(parseAntigravityCliResponse(JSON.stringify({ response: 'ok', stats: {} })), 'ok');
  });

  it('throws on an error envelope with no response', () => {
    const envelope = JSON.stringify({ error: { type: 'AuthError', message: 'credentials expired', code: 401 } });
    assert.throws(() => parseAntigravityCliResponse(envelope), /AuthError.*credentials expired/);
  });
});

describe('CLI adapters keep the prompt off argv', () => {
  const ragPrompt = 'L'.repeat(37_505);

  it('codex exec args are model-only (prompt is stdin)', () => {
    class Testable extends CodexCliAdapter {
      args(model: string): string[] {
        return this.buildArgs(model);
      }
    }
    const args = new Testable(vault).args('gpt-5.6-sol');
    assert.deepEqual(args, ['exec', '--model', 'gpt-5.6-sol']);
    assert.ok(!args.some((arg) => arg.includes(ragPrompt)));
  });

  it('qwen args are model-only (prompt is stdin)', () => {
    class Testable extends QwenCliAdapter {
      args(model: string): string[] {
        return this.buildArgs(model);
      }
    }
    const args = new Testable(vault).args('qwen3-coder-plus');
    assert.deepEqual(args, ['--model', 'qwen3-coder-plus']);
  });

  it('agy puts flags before -p so -p does not swallow --output-format', () => {
    class Testable extends AntigravityCliAdapter {
      args(model: string): string[] {
        return this.buildArgs(model);
      }
    }
    const args = new Testable(vault).args('gemini-3.7-flash-medium');
    assert.deepEqual(args, ['--output-format', 'json', '--model', 'gemini-3.7-flash-medium']);
    assert.ok(!args.includes('-p'));
  });

  it('agy refuses a 37k prompt instead of putting it on -p', async () => {
    const adapter = new AntigravityCliAdapter(vault);
    await assert.rejects(
      () => adapter.generate({ prompt: ragPrompt, model: 'gemini-3.7-flash-medium' }),
      /refuses prompts over/,
    );
  });

  it('copilot refuses a 37k prompt instead of spawning -p with it', async () => {
    const adapter = new CopilotCliAdapter(vault);
    await assert.rejects(
      () => adapter.generate({ prompt: ragPrompt, model: 'gpt-4.1' }),
      new RegExp(`refuses prompts over ${MAX_COPILOT_ARGV_PROMPT_CHARS}`),
    );
  });

  it('copilot argv carries @prompt-file, not the prompt body', () => {
    const path = '/tmp/mcp-copilot-prompt-test/prompt.txt';
    const args = buildCopilotGenerateArgs('gpt-4.1', path);
    assert.deepEqual(args, ['-p', `@${path}`, '--model', 'gpt-4.1', '--allow-all-tools']);
    assert.ok(!args.includes(ragPrompt));
    assert.ok(args.every((arg) => arg.length < 200));
  });
});

describe('parseQwenCliResponse', () => {
  it('returns the response field on success', () => {
    assert.equal(parseQwenCliResponse(JSON.stringify({ response: 'ok' })), 'ok');
  });

  it('returns non-JSON output trimmed as-is', () => {
    assert.equal(parseQwenCliResponse('  plain text  \n'), 'plain text');
  });

  it('throws on an error envelope with no response', () => {
    const envelope = JSON.stringify({ error: { type: 'QuotaError', message: 'quota exceeded' } });
    assert.throws(() => parseQwenCliResponse(envelope), /QuotaError.*quota exceeded/);
  });
});
