import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { validateShell, parsePosixShell } from '../contracts/scanner/posix-shell-validation.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { parsePackageJson } from '../contracts/scanner/package-json.mjs';

interface Edge { kind: string; target: string }
const entries = (source: string) => {
  const result = validateShell(source);
  assert.equal(result.status, 'parsed', JSON.stringify(result));
  return result.edges.filter((edge: Edge) => edge.kind === 'entry').map((edge: Edge) => edge.target);
};
function fixture(source: string, path = 'run.sh', rootKind = 'posix_shell') {
  const bytes = Buffer.from(source);
  const record = { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return [{ schema: 'wp00-root-input/v1', rootKind, ...record, bytes },
    { schema: 'wp00-root-authority/v1', record, inventoryPaths: [path], bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}` }];
}
const reject = (source: string) => {
  const result = validateShell(source);
  assert.equal(result.status, 'rejected', source);
  assert.deepEqual(result.edges, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
};

describe('SCAN-ROOT-SHELL semantic component', () => {
  it('SCAN-ROOT-07 accepts required lists, pipes, and-or, subshells, quotes, escapes and assignments', () => {
    assert.deepEqual(entries('MODE=fast first "a b" | second && (third; fourth) || fifth;').sort(), ['first', 'second', 'third', 'fourth', 'fifth'].sort());
    assert.deepEqual(entries('one \\\narg &&\n two'), ['one', 'two']);
    assert.deepEqual(entries("'ec'\\ho literal\\;argument"), ['echo']);
    assert.equal(validateShell('A=one; B="two"').status, 'parsed');
    assert.equal(validateShell('# comment only\n').status, 'parsed');
  });
  it('validates dollar/backtick substitution bodies and permits ordinary argument parameters without resolving executable names from them', () => {
    assert.deepEqual(entries('echo "$(printf %s "$(pwd)")" `date` "$HOME" ${USER}').sort(), ['echo', 'printf', 'pwd', 'date'].sort());
    for (const source of ['$COMMAND arg', 'prefix${NAME} arg', '$(printf tool) arg', '`printf tool` arg', '*tool arg']) reject(source);
    for (const source of ['echo $(eval "$INPUT")', 'echo `eval "$INPUT"`', 'echo ${!INDIRECT}', 'echo ${NAME:-$(eval "$INPUT")}']) reject(source);
  });
  it('resolves supported literal wrapper/eval forms and rejects dynamic inputs and unknown wrapper flags', () => {
    assert.ok(entries('env -i MODE=test command -p exec echo ok').includes('echo'));
    assert.ok(entries('eval "echo literal"').includes('echo'));
    assert.ok(entries('sh -c "echo literal"').includes('echo'));
    assert.ok(entries('sh ./script.sh').includes('./script.sh'));
    assert.ok(entries('node --import tsx --test tests/*.test.ts').includes('tsx'));
    assert.ok(entries('node script.js "$HOME"').includes('script.js'));
    for (const source of ['e\\val "$INPUT"', 'command eval "$INPUT"', 'env X=x eval "$INPUT"', 'exec "$CMD"',
      'env -S "eval secret-canary"', 'command -Z echo', 'sh -xc "echo ok"', 'sh -c "$INPUT"', 'alias x="eval secret-canary"',
      'xargs sh', 'node --eval="secret-canary"', 'node "$FLAG" "$INPUT"', 'node --unknown script.js', 'node --import "$MODULE"',
      'find . "$FLAG" sh', 'find . -exec sh {} \\;']) reject(source);
  });
  it('SCAN-ROOT-08 rejects malformed/trailing operators, unsupported grammar and nested unsafe commands without partial edges', () => {
    for (const source of ['echo &&', 'echo |', 'echo ||\n', '&& echo', '; echo', 'echo;;next', 'echo (next)', '()',
      'echo\n&&next', 'echo > output', 'echo & next', 'if echo; then next; fi', 'echo $((1+2))', 'echo $(one &&)',
      'safe; (eval "$secret-canary")', 'f() { echo; }', 'echo "unterminated']) reject(source);
  });
  it('binds the real shell adapter to expected bytes and wires real package scripts without trusted test stubs', () => {
    const args = fixture('echo ok');
    assert.equal(parsePosixShell(...args).status, 'parsed');
    const bad = { ...args[1], record: { ...args[1]?.record, sha256: 'c'.repeat(64) } };
    assert.equal(parsePosixShell(args[0], bad).status, 'rejected');
    const safe = fixture('{"scripts":{"start":"MODE=test node index.js && echo ok"}}', 'package.json', 'package_json');
    assert.equal(parsePackageJson(...safe).status, 'parsed');
    const unsafe = fixture(JSON.stringify({ main: 'index.js', scripts: { start: 'eval "$INPUT"' } }), 'package.json', 'package_json');
    const result = parsePackageJson(...unsafe);
    assert.equal(result.status, 'rejected');
    assert.deepEqual(result.edges, []);
  });
});
