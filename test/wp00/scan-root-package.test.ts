import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { createPackageJsonParser, parsePackageJson, parseStrictJson } from '../contracts/scanner/package-json.mjs';

function fixture(text: string, path = 'package.json') {
  const bytes = Buffer.from(text);
  const record = { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return [
    { schema: 'wp00-root-input/v1', rootKind: 'package_json', ...record, bytes },
    { schema: 'wp00-root-authority/v1', record, inventoryPaths: [path], bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}` },
  ];
}
interface Edge { kind: string; field: string; target: string }
interface Result { status: string; edges: Edge[]; diagnostics: { code: string }[] }
const reject = (result: Result, code: string) => {
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.edges, []);
  assert.equal(result.diagnostics[0]?.code, code);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
};

describe('SCAN-ROOT-PACKAGE component', () => {
  it('SCAN-ROOT-05 extracts all normative static package fields and preserves export branch priority', () => {
    const data = { name: 'fixture', main: 'index.js', module: './esm.js', bin: { fixture: 'cli.js' },
      files: ['dist/**', 'README.md'], workspaces: ['packages/*'],
      exports: { '.': { node: './node.js', default: ['./fallback.js', null] }, './*': './lib/*.js' } };
    const result: Result = parsePackageJson(...fixture(JSON.stringify(data)));
    assert.equal(result.status, 'parsed');
    assert.deepEqual(result.edges.map((edge) => edge.target).sort(), ['./esm.js', './fallback.js', './lib/*.js', './node.js', 'README.md', 'cli.js', 'dist/**', 'index.js', 'packages/*'].sort());
    assert.ok(result.edges.some((edge) => edge.field === '/exports/0/./0/node'));
    assert.ok(result.edges.some((edge) => edge.field === '/exports/0/./1/default/0'));
    assert.deepEqual(parsePackageJson(...fixture(JSON.stringify(data))), result);
    assert.equal(parsePackageJson(...fixture('{"bin":"cli.js","exports":"./index.js","workspaces":{"packages":["apps/*"]}}')).status, 'parsed');
    assert.equal(parsePackageJson(...fixture('{"exports":null}')).status, 'parsed');
  });
  it('SCAN-ROOT-06 rejects nested duplicate keys, invalid strict JSON and malformed field structures', () => {
    for (const text of ['{"scripts":{"x":"one","x":"two"}}', '{"name":"a","na\\u006de":"b"}',
      '{"dependencies":{"a":"1","a":"2"}}', '{"main":"x",}', '{/*comment*/}', '\ufeff{}', '[]', 'null']) {
      reject(parsePackageJson(...fixture(text)), 'invalid_input');
    }
    for (const value of [{ scripts: [] }, { main: 2 }, { bin: false }, { files: {} }, { workspaces: {} }, { exports: true }]) {
      reject(parsePackageJson(...fixture(JSON.stringify(value))), 'invalid_input');
    }
    assert.throws(() => parseStrictJson(Buffer.from([0xff])), /WP00 package: invalid_json/);
    assert.deepEqual(parseStrictJson(Buffer.from('{"a":{"same":1},"b":{"same":2}}')), { a: { same: 1 }, b: { same: 2 } });
  });
  it('requires separately trusted shell admission and delegates every script without claiming actual shell coverage', () => {
    const input = fixture('{"main":"index.js","scripts":{"prestart":"check","start":"node index.js"}}');
    reject(createPackageJsonParser({ validateShell: null })(...input), 'parser_unavailable');
    const calls: string[] = [];
    const parse = createPackageJsonParser({ validateShell(command: string) {
      calls.push(command);
      return { status: 'parsed', edges: [], diagnostics: [] };
    } });
    const result: Result = parse(...input);
    assert.equal(result.status, 'parsed');
    assert.deepEqual(calls, ['check', 'node index.js']);
    assert.equal(result.edges.filter((edge) => edge.kind === 'command').length, 2);
  });
  it('returns no partial edges and sanitizes validator rejection, malformed outputs, asynchronous values and exceptions', () => {
    const input = fixture('{"main":"index.js","scripts":{"start":"secret-canary"}}');
    const outputs = [null, Promise.resolve({ status: 'parsed' }), { status: 'parsed', edges: [], diagnostics: [{}] }];
    for (const output of outputs) reject(createPackageJsonParser({ validateShell: () => output })(...input), 'invalid_parser_result');
    const parse = createPackageJsonParser({ validateShell: () => ({ status: 'rejected', edges: [], diagnostics: [{ code: 'unresolved_execution', message: 'secret-canary' }] }) });
    reject(parse(...input), 'unresolved_execution');
    reject(createPackageJsonParser({ validateShell: () => { throw new Error('secret-canary'); } })(...input), 'parser_failure');
  });
  it('rejects unsupported execution fields, unsafe targets and ambiguous exports without inventing devcontainer support', () => {
    for (const value of [{ browser: './browser.js' }, { pnpm: { patchedDependencies: { native: 'native.patch' } } }, { workspaces: { nohoist: [] } }]) {
      reject(parsePackageJson(...fixture(JSON.stringify(value))), 'unsupported_syntax');
    }
    for (const value of [{ main: '../secret-canary' }, { files: ['/secret-canary'] }, { exports: 'external' }, { module: '${secret-canary}' }]) {
      reject(parsePackageJson(...fixture(JSON.stringify(value))), 'unresolved_execution');
    }
    reject(parsePackageJson(...fixture('{"exports":{".":"./a.js","default":"./b.js"}}')), 'ambiguous_structure');
    reject(parsePackageJson(...fixture('{}', '.devcontainer/devcontainer.json')), 'parser_unavailable');
  });
});
