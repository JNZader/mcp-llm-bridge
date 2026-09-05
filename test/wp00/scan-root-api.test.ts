import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { createRootParserRegistry, parseExecutionRoot, ROOT_PARSERS } from '../contracts/scanner/root-api.mjs';

function fixture() {
  const bytes = Buffer.from('{"scripts":{"start":"secret-canary"}}');
  const record = { path: 'package.json', mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return {
    input: { schema: 'wp00-root-input/v1', rootKind: 'package_json', ...record, bytes },
    expected: { schema: 'wp00-root-authority/v1', bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}`, record: { ...record }, inventoryPaths: ['package.json'] },
  };
}
const parsed = () => ({ status: 'parsed', edges: [], diagnostics: [] });
const rejection = (result: { status: string; edges: unknown[]; diagnostics: { code: string }[] }, code: string) => {
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.edges, []);
  assert.equal(result.diagnostics[0]?.code, code);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
};

describe('SCAN-ROOT-API', () => {
  it('SCAN-ROOT-01 returns deterministic closed results through a captured registry', () => {
    const { input, expected } = fixture();
    const entries = { package_json: () => ({ status: 'parsed', diagnostics: [], edges: [
      { kind: 'entry', field: 'z', target: 'z.js', discarded: 'secret-canary' },
      { kind: 'entry', field: 'a', target: 'a.js' },
    ] }) };
    const parse = createRootParserRegistry(entries);
    entries.package_json = () => { throw new Error('secret-canary'); };
    const result = parse(input, expected);
    assert.deepEqual(result, { status: 'parsed', rootKind: 'package_json', path: 'package.json', parserId: 'package-json-v1', parserVersion: 1,
      inputSha256: input.sha256, diagnostics: [], edges: [{ kind: 'entry', field: 'a', target: 'a.js' }, { kind: 'entry', field: 'z', target: 'z.js' }] });
    assert.deepEqual(parse(input, expected), result);
    assert.equal(Object.isFrozen(ROOT_PARSERS), true);
    assert.throws(() => createRootParserRegistry({ unknown: parsed }), /Invalid root parser registration/);
  });
  it('SCAN-ROOT-02 sanitizes failures and sorts stable diagnostics without partial success', () => {
    const { input, expected } = fixture();
    const parse = createRootParserRegistry({ package_json: () => ({ status: 'rejected', edges: [], diagnostics: [
      { code: 'unresolved_execution', path: 'secret-canary', line: 2, column: 1, field: 'scripts' },
      { code: 'unsupported_syntax', line: 1, column: 1, field: null },
    ] }) });
    const result = parse(input, expected);
    assert.deepEqual(result.diagnostics.map((item: { line: number }) => item.line), [1, 2]);
    rejection(result, 'unsupported_syntax');
    const throwing = createRootParserRegistry({ package_json: () => { throw new Error('secret-canary'); } });
    rejection(throwing(input, expected), 'parser_failure');
    for (const malformed of [null, { status: 'parsed', edges: [], diagnostics: [{}] }, { status: 'rejected', edges: [{}], diagnostics: [] },
      { status: 'rejected', edges: [], diagnostics: [{ code: 'secret-canary', line: null, column: null, field: null }] }]) {
      rejection(createRootParserRegistry({ package_json: () => malformed })(input, expected), 'invalid_parser_result');
    }
  });
  it('rejects independently mismatched identity, bytes, and missing or duplicate inventory membership before dispatch', () => {
    const { input, expected } = fixture();
    let calls = 0;
    const parse = createRootParserRegistry({ package_json: () => { calls += 1; return parsed(); } });
    for (const patch of [{ path: 'other.json' }, { mode: 0o100755 }, { length: input.length + 1n }, { sha256: 'c'.repeat(64) }]) {
      rejection(parse(input, { ...expected, record: { ...expected.record, ...patch } }), 'authority_mismatch');
    }
    for (const inventoryPaths of [[], ['package.json', 'package.json'], ['other.json']]) {
      rejection(parse(input, { ...expected, inventoryPaths }), 'authority_mismatch');
    }
    rejection(parse({ ...input, bytes: Buffer.from('secret-canary') }, expected), 'authority_mismatch');
    rejection(parse(input, { ...expected, bindingHash: '' }), 'authority_mismatch');
    rejection(parse(input, { ...expected, wp00ArtifactHash: '' }), 'authority_mismatch');
    assert.equal(calls, 0);
    assert.equal(parse(input, expected).status, 'parsed');
  });
  it('rejects malformed API values and reports unavailable grammar without claiming unsupported syntax', () => {
    const { input, expected } = fixture();
    for (const value of [null, {}, { ...input, rootKind: 'toString' }, { ...input, path: '../secret-canary' },
      { ...input, length: -1n }, { ...input, mode: 0o160000 }, { ...input, bytes: [] }, { ...input, sha256: 'bad' }]) {
      rejection(parseExecutionRoot(value, expected), 'invalid_input');
    }
    for (const rootKind of Object.keys(ROOT_PARSERS)) rejection(parseExecutionRoot({ ...input, rootKind }, expected), 'parser_unavailable');
  });
  it('isolates parser byte mutations from the observed input buffer', () => {
    const { input, expected } = fixture();
    const original = Buffer.from(input.bytes);
    const parse = createRootParserRegistry({ package_json: (observed: { bytes: Uint8Array }) => { observed.bytes.fill(0); return parsed(); } });
    assert.equal(parse(input, expected).status, 'parsed');
    assert.deepEqual(input.bytes, original);
  });
});
