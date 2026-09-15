import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { composeCommand, composeText, decodeComposeValues, tokenizeComposeCommand } from '../contracts/scanner/compose-values.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { decodeBoundedYaml } from '../contracts/scanner/bounded-yaml.mjs';

function value(source: string) {
  const result = decodeComposeValues(`command: ${source}\n`);
  assert.equal(result.status, 'decoded');
  assert.equal(Object.hasOwn(result, 'edges'), false);
  return result.value.command;
}

describe('SCAN-ROOT-COMPOSE value component, not root admission', () => {
  it('distinguishes omitted/null inheritance from empty-list and empty-string overrides', () => {
    for (const source of ['', 'null', 'Null', 'NULL', '~']) assert.equal(composeCommand(value(source)), null);
    assert.equal(composeCommand(undefined), null);
    assert.deepEqual(composeCommand(value('[]')), []);
    assert.deepEqual(composeCommand(value("''")), []);
    assert.deepEqual(composeCommand(value('"null"')), ['null']);
    assert.deepEqual(composeCommand(value("'[]'")), ['[]']);
  });
  it('enables only empty flow sequences for Compose while preserving the default YAML contract', () => {
    assert.throws(() => decodeBoundedYaml('command: []'));
    assert.equal(decodeComposeValues('command: []').status, 'decoded');
    for (const source of ['command: [echo, ok]', 'command: {}', 'command: &x []', 'command: *x', 'command: !!seq []', 'command: []\ncommand: []']) {
      assert.equal(decodeComposeValues(source).status, 'rejected');
    }
  });
  it('preserves block-list argv literally without shell parsing and handles literal dollar escapes', () => {
    const node = value('\n  - echo\n  - "$$HOME"\n  - "a;b"\n  - "a b"\n  - ""');
    assert.deepEqual(composeCommand(node), ['echo', '$HOME', 'a;b', 'a b', '']);
    assert.deepEqual(composeCommand(value("'echo $$HOME'")), ['echo', '$HOME']);
    assert.equal(composeText(value("'$$$$'")), '$$');
  });
  it('tokenizes quoted and escaped strings without using image shell semantics', () => {
    assert.deepEqual(tokenizeComposeCommand('echo "a b" \'\' literal\\ space'), ['echo', 'a b', '', 'literal space']);
    assert.deepEqual(tokenizeComposeCommand("sh -c 'echo \"$HOME\" && printf ok'"), ['sh', '-c', 'echo "$HOME" && printf ok']);
    assert.deepEqual(tokenizeComposeCommand('echo a\\tb a\\nb'), ['echo', 'a\tb', 'a\nb']);
    assert.deepEqual(tokenizeComposeCommand('echo\nnext'), ['echo', 'next']);
    assert.deepEqual(tokenizeComposeCommand("echo '$(touch sentinel)'"), ['echo', '$(touch sentinel)']);
  });
  it('rejects host interpolation, scalar ambiguity and malformed or unsupported string tokenization', () => {
    for (const source of ['"$HOST"', '"${HOST}"', '"${HOST:-fallback}"', 'false', '123']) assert.throws(() => composeCommand(value(source)));
    for (const source of ['echo "broken', 'echo trailing\\', 'echo && next', 'echo;next', 'echo $(date)', 'echo `date`']) {
      assert.throws(() => tokenizeComposeCommand(source));
    }
    assert.throws(() => composeCommand(value('\n  - echo\n  - null')));
  });
});
