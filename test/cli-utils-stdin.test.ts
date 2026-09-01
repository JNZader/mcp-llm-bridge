import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertPromptNotOnArgv, execCliAsync, execCliSync } from '../src/adapters/cli-utils.js';

// Regression: a child that reads stdin (like `cat`, or `codex exec`) must get an
// immediate EOF when no input is supplied — otherwise it blocks until the timeout
// and returns empty (the codex-cli empty-output bug).
test('execCliAsync ends stdin when no input, so stdin-reading CLIs do not hang', async () => {
  const t0 = Date.now();
  const { stdout } = await execCliAsync('cat', [], { timeout: 5000 });
  assert.equal(stdout, '', 'cat with EOF stdin produces empty stdout');
  assert.ok(Date.now() - t0 < 4000, 'completed well before the timeout (no hang)');
});

test('execCliAsync still forwards input via stdin when provided', async () => {
  const { stdout } = await execCliAsync('cat', [], { input: 'hola', timeout: 5000 });
  assert.equal(stdout, 'hola');
});

test('execCliSync forwards the prompt on stdin, not argv', () => {
  const prompt = 'legal-rag-stdin';
  const stdout = execCliSync('cat', [], { input: prompt, timeout: 5000 });
  assert.equal(stdout, prompt);
});

test('assertPromptNotOnArgv rejects a 37k -p interpolation', () => {
  const prompt = 'ñ'.repeat(37_505);
  assert.throws(
    () => assertPromptNotOnArgv('copilot', ['-p', prompt, '--model', 'x'], [prompt]),
    /refused to put prompt\/system on argv/,
  );
});

test('assertPromptNotOnArgv allows print-mode -p without the prompt value', () => {
  const prompt = 'ñ'.repeat(37_505);
  assert.doesNotThrow(() =>
    assertPromptNotOnArgv('agy', ['-p', '--output-format', 'json', '--model', 'x'], [prompt]),
  );
});
