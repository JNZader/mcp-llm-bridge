import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { decodeBoundedYaml, YAML_SCALAR } from '../contracts/scanner/bounded-yaml.mjs';

const decode = (source: string) => decodeBoundedYaml(source).value;
const plain = (source: string) => JSON.parse(JSON.stringify(decode(source)));
const reject = (source: string) => assert.throws(() => decode(source), { message: 'WP00 YAML: unsupported_or_invalid' });

describe('Bounded YAML decoding component, not Actions admission', () => {
  it('optionally preserves unforgeable scalar style metadata without changing default textual decoding', () => {
    const source = 'plain: false\nquoted: "false"\nblock: |-\n  false\n';
    const value = decodeBoundedYaml(source, { preserveScalarStyle: true }).value;
    assert.equal(value.plain[YAML_SCALAR], true);
    assert.deepEqual([value.plain.style, value.quoted.style, value.block.style], ['plain', 'quoted', 'block']);
    assert.deepEqual(plain(source), { plain: 'false', quoted: 'false', block: 'false' });
  });
  it('decodes nested maps, block sequences and compact sequence mappings without implicit scalar coercion', () => {
    const source = 'on: push\njobs:\n  build:\n    steps:\n      - name: Check\n        run: echo ok\n      - uses: local/action\n    env:\n      FLAG: true\n      COUNT: 12\n';
    assert.deepEqual(plain(source), { on: 'push', jobs: { build: { steps: [{ name: 'Check', run: 'echo ok' }, { uses: 'local/action' }], env: { FLAG: 'true', COUNT: '12' } } } });
    assert.deepEqual(plain('items:\n  - one\n  - two\nempty:\n'), { items: ['one', 'two'], empty: null });
    assert.equal(decodeBoundedYaml(source).status, 'decoded');
    assert.equal(Object.hasOwn(decodeBoundedYaml(source), 'edges'), false);
  });
  it('decodes quoted keys, escaped scalar values and literal hashes while removing only separated comments', () => {
    assert.deepEqual(plain("'quoted:key': 'it''s # literal' # comment\nurl: https://example.test/#fragment\nvalue: \"line\\nnext\\t\\x41\\u0042\\U0001F600\"\n"),
      { 'quoted:key': "it's # literal", url: 'https://example.test/#fragment', value: 'line\nnext\tAB😀' });
    assert.equal(decode('value: "\\e\\N\\_\\L\\P"').value, '\x1b\u0085\u00a0\u2028\u2029');
    assert.deepEqual(plain('__proto__: literal\nconstructor: literal\n'), JSON.parse('{"__proto__":"literal","constructor":"literal"}'));
    assert.equal(decode('value: "\\x41BC"').value, 'ABC');
    assert.equal(decode("name: Don't fail # comment").name, "Don't fail");
    assert.equal(decode("run: echo 'a # YAML comment'").run, "echo 'a");
    assert.deepEqual(plain('items:\n- one\n- two\nnext: value\n'), { items: ['one', 'two'], next: 'value' });
    assert.deepEqual(plain('items:\n  - |-\n    first\n    second\n'), { items: ['first\nsecond'] });
  });
  it('preserves literal block bytes, comments, explicit indentation and strip/clip/keep chomping', () => {
    assert.equal(decode('run: |\n  echo one\n  # literal\n\nnext: value\n').run, 'echo one\n# literal\n');
    assert.equal(decode('run: |-\n  echo one\n\n').run, 'echo one');
    assert.equal(decode('run: |+\n  echo one\n\n').run, 'echo one\n\n');
    assert.equal(decode('run: |2-\n    indented\n').run, '  indented');
    assert.equal(decode('run: |-2\n    indented\n').run, '  indented');
    assert.equal(decode('run: |\n  no final break').run, 'no final break');
    assert.equal(decode('run: |\n\n').run, '');
    assert.equal(decode('run: |+\n\n').run, '\n');
  });
  it('folds ordinary lines but retains blank separation and more-indented block content', () => {
    assert.equal(decode('run: >-\n  echo one\n  two\n\n  next\n').run, 'echo one two\nnext');
    assert.equal(decode('run: >\n  one\n    nested\n\n  last\n').run, 'one\n  nested\n\nlast\n');
    assert.equal(decode('run: >+\n  one\n  two\n\n').run, 'one two\n\n');
    assert.equal(decode('run: |\r\n  echo\r\n').run, 'echo\n');
  });
  it('rejects duplicate decoded keys, aliases, anchors, tags, merges, flow structures and ambiguous indentation', () => {
    for (const source of ['x: one\nx: two', 'x: one\n"x": two', 'x: &anchor secret-canary', 'x: *anchor',
      'x: !!str secret-canary', '<<: value', "'<<': value", 'x: [one, two]', 'x: {a: b}',
      'x:\n\tbad: value', 'x:\n  a: one\n b: two', '---\nx: one', 'x: one\n...\n', 'x: |0\n  invalid']) reject(source);
  });
  it('rejects malformed scalar escapes and bounds source/depth without executing scalar text', () => {
    for (const source of ['x: "\\q"', 'x: "\\uD800"', 'x: "\\U00110000"', 'x: "unterminated', "x: 'unterminated", 'x: secret-canary\0']) reject(source);
    reject('x: ' + 'a'.repeat(65_537));
    reject(Array.from({ length: 35 }, (_, index) => ' '.repeat(index * 2) + 'x:').join('\n'));
    assert.equal(decode('run: eval "$INPUT"').run, 'eval "$INPUT"'); // Semantics remain adapter responsibility.
  });
});
