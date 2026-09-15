import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { parseGitHubActions } from '../contracts/scanner/github-actions-yaml.mjs';

interface Edge { kind: string; field: string; target: string }
function fixture(source: string) {
  const bytes = Buffer.from(source);
  const path = '.github/workflows/check.yml';
  const record = { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return [{ schema: 'wp00-root-input/v1', rootKind: 'github_actions', ...record, bytes },
    { schema: 'wp00-root-authority/v1', record, inventoryPaths: [path], bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}` }];
}
const workflow = (steps: string, runner = 'ubuntu-latest') => `on: push\njobs:\n  build:\n    runs-on: ${runner}\n    steps:\n${steps}\n`;
const parse = (source: string) => parseGitHubActions(...fixture(source));
function accepted(source: string): Edge[] {
  const result = parse(source);
  assert.equal(result.status, 'parsed', JSON.stringify(result));
  return result.edges;
}
function rejected(source: string) {
  const result = parse(source);
  assert.equal(result.status, 'rejected', source);
  assert.deepEqual(result.edges, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
}

describe('SCAN-ROOT-ACTIONS semantic component', () => {
  it('SCAN-ROOT-09 inventories uses/run and effective workflow/job/step defaults and environment', () => {
    const source = 'name: CI\non:\n  push:\n  pull_request:\nenv:\n  MODE: base\n  KEEP: yes\ndefaults:\n  run:\n    shell: bash\n    working-directory: base\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    env:\n      MODE: job\n    defaults:\n      run:\n        working-directory: job\n    steps:\n      - uses: actions/checkout@0123456789abcdef\n      - uses: ./local/action\n      - id: check\n        run: node index.js\n        env:\n          MODE: step\n        working-directory: step\n      - run: echo next\n';
    const edges = accepted(source);
    const target = (suffix: string) => edges.find((edge) => edge.field.endsWith(suffix))?.target;
    assert.equal(target('/2/env/MODE'), 'step');
    assert.equal(target('/3/env/MODE'), 'job');
    assert.equal(target('/2/env/KEEP'), 'yes');
    assert.equal(target('/2/working-directory'), 'step');
    assert.equal(target('/3/working-directory'), 'job');
    assert.equal(target('/2/shell'), 'bash --noprofile --norc -e -o pipefail {0}');
    assert.ok(edges.some((edge) => edge.target === './local/action'));
    assert.ok(edges.some((edge) => edge.kind === 'entry' && edge.target === 'index.js'));
  });
  it('preserves literal/folded command bytes and applies real nested shell validation', () => {
    const edges = accepted(workflow('      - run: |\n          echo "$(printf ok)"\n          echo next\n      - run: >-\n          echo first\n          second'));
    assert.ok(edges.some((edge) => edge.target === 'echo "$(printf ok)"\necho next\n'));
    assert.ok(edges.some((edge) => edge.target === 'echo first second'));
    assert.ok(edges.some((edge) => edge.kind === 'entry' && edge.target === 'printf'));
    rejected(workflow('      - run: echo safe\n      - run: |\n          echo $(eval "$secret-canary")'));
  });
  it('distinguishes unspecified Unix, explicit bash/sh and unsupported runner/shell semantics', () => {
    const edges = accepted(workflow('      - run: echo one\n      - run: echo two\n        shell: sh\n      - run: echo three\n        shell: bash', 'macos-14'));
    assert.ok(edges.some((edge) => edge.target === 'bash -e {0} (fallback: sh -e {0})'));
    assert.ok(edges.some((edge) => edge.target === 'sh -e {0}'));
    for (const runner of ['windows-latest', 'self-hosted', '"${{ matrix.os }}"']) rejected(workflow('      - run: echo ok', runner));
    for (const shell of ['pwsh', 'python', 'bash {0}', '"${{ matrix.shell }}"']) rejected(workflow(`      - run: echo ok\n        shell: ${shell}`));
  });
  it('SCAN-ROOT-10 rejects ambiguous YAML, duplicate fields and unhandled execution-affecting fields', () => {
    for (const steps of ['      - run: echo first\n        run: echo second', '      - run: &command echo first',
      '      - run: *command', '      - run: !!str echo first', '      - run: echo ok\n        <<: *defaults',
      '      - uses: actions/checkout@v4\n        run: echo ok', '      - uses: actions/checkout@v4\n        with:\n          path: elsewhere',
      '      - run: echo ok\n        if: success()', '      - id: same\n        run: echo ok\n      - id: same\n        run: echo ok']) rejected(workflow(steps));
    for (const key of ['container', 'services', 'strategy', 'uses', 'with']) {
      rejected(workflow('      - run: echo ok').replace('    steps:', `    ${key}: secret-canary\n    steps:`));
    }
    rejected('on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n');
  });
  it('rejects decoded expressions and dynamic commands without partial edges or source diagnostics', () => {
    for (const run of ['echo ${{ secrets.secret-canary }}', 'eval "$INPUT"', 'echo &&', '"echo $\\u007b{ secrets.secret-canary }}"',
      '|\n          echo ${{\n            secrets.secret-canary }}']) rejected(workflow(`      - run: echo safe\n      - run: ${run}`));
    rejected(workflow('      - run: echo ok\n        env:\n          TOKEN: "${{ secrets.secret-canary }}"'));
    rejected(workflow('      - run: echo ok\n        working-directory: ../escape'));
  });
  it('preserves scalar schema distinctions and independent trusted byte binding', () => {
    for (const run of ['false', 'null', '123', '~']) rejected(workflow(`      - run: ${run}`));
    accepted(workflow('      - run: "false"\n      - run: |-\n          false'));
    rejected(workflow('      - run: echo ok\n        env:\n          FLAG: false'));
    accepted(workflow('      - run: echo ok\n        env:\n          FLAG: "false"\n          EMPTY: ""'));
    const args = fixture(workflow('      - run: echo ok'));
    const authority = { ...args[1], record: { ...args[1]?.record, sha256: 'c'.repeat(64) } };
    assert.equal(parseGitHubActions(args[0], authority).status, 'rejected');
  });
});
