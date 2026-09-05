import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM scanner module.
import { createDirectSinkMatcher } from '../contracts/scanner/typescript-sink-matcher.mjs';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const policy = 'nodenext-explicit-v1';
const record = (path: string, text: string) => ({ path, mode: 0o100644, length: BigInt(Buffer.byteLength(text)), sha256: hash(text), bytes: Buffer.from(text) });
function catalogs(count = 1) {
  const emptyDigest = `sha256:${hash('[]')}`;
  const ledger = { schema: 'wp00-baseline-ledger/v3', source: { grade: 'read', commit: 'a'.repeat(40), parser: 'typescript@5.9.3', inclusion: 'historical source', discovery: 'fixture' },
    fields: ['pathId', 'startLine', 'endLine', 'exportNameOrNull', 'calleeId', 'arity', 'signatureId', 'ownerUnitId', 'dispositionId', 'fixtureId'],
    paths: ['old.ts'], callees: ['oldSink'], signatures: ['H-HELPER'], ownerUnits: ['ERR-HTTP-FOUNDATION'], dispositions: ['typed_safe_projection'],
    fixtures: Array.from({ length: count }, (_, i) => `FX-${i}`), records: Array.from({ length: count }, (_, i) => [0, i + 1, i + 1, null, 0, 1, 0, 0, 0, i]),
    completeness: { records: count, paths: 1, bySignature: { 'H-HELPER': count }, byOwner: { 'ERR-HTTP-FOUNDATION': count },
      regeneratedAdditions: { durable: 0, helperCalls: 0 }, sourceEvidenceDigest: emptyDigest, addedEvidenceNormalizationVersion: 'ts-expression-slice-lf/v1',
      sourceEvidenceDigestSchema: 'wp00-added-evidence-preimage/v1', sourceEvidenceDigestCoverage: 0 } };
  const fixtures = { schema: 'wp00-fixture-catalog/v3',
    join: 'record index i => fixtureId=ledger.fixtures[i]; protocol/projection from covering run [first,last,protocolId,projectionId]; addedEvidence=[recordIndex,startOffset,endOffset,payloadSha256,payloadBase64]',
    protocols: ['http'], projections: ['typed_safe_projection'], protocolProjectionRuns: [[0, count - 1, 0, 0]],
    normalizationVersion: 'ts-expression-slice-lf/v1', aggregateSchema: 'wp00-added-evidence-preimage/v1', sourceEvidenceDigest: emptyDigest, addedEvidence: [], entryCount: count };
  return { ledgerBytes: Buffer.from(JSON.stringify(ledger)), fixtureCatalogBytes: Buffer.from(JSON.stringify(fixtures)) };
}
const declarationText = 'export function send(value: unknown) {}';
function selector(callText: string, exportName: string | null = null, declaration = declarationText, startOffset = 0) {
  return { recordIndex: 0, fixtureId: 'FX-0', callsiteScope: { path: 'main.ts', inputSha256: hash(callText), exportName },
    declaration: { path: 'sink.ts', inputSha256: hash(declaration), startOffset, endOffset: declaration.length,
      astSha256: hash(declaration.slice(startOffset).replace(/\r\n?/g, '\n')) } };
}
const inputs = (main: string, sink = declarationText) => [record('package.json', '{"type":"module"}'), record('main.ts', main), record('sink.ts', sink)];
const projection = (selectors: unknown[]) => ({ schema: 'wp00-current-sink-selectors/v1', selectors });
const matcher = (selected: unknown, count = 1) => createDirectSinkMatcher({ ...catalogs(count), selectCurrentDeclarations: () => selected });

describe('Trusted current declaration direct sink matcher', () => {
  it('matches named aliases through reexports and namespace calls with current locations', () => {
    for (const main of ["import { renamed as local } from './barrel.js';\nlocal(1);", "import * as ns from './sink.js';\nns.send(1);"]) {
      const records = [...inputs(main), record('barrel.ts', "export { send as renamed } from './sink.js';")];
      const result = matcher(projection([selector(main)])).inspect(records, policy);
      assert.equal(result.status, 'inspected');
      assert.equal(result.matches.length, 1);
      assert.deepEqual(result.unclassified, []);
      const match = result.matches[0];
      assert.equal(match.fixtureId, 'FX-0');
      assert.equal(match.metadata, 'historical_expectation');
      assert.deepEqual(match.sink, { path: 'main.ts', module: 'main.ts', startLine: 2, endLine: 2, exportName: null,
        callee: main.includes('ns.send') ? 'ns.send' : 'local', arity: 1, signatureId: 'H-HELPER', ownerUnit: 'ERR-HTTP-FOUNDATION', disposition: 'typed_safe_projection' });
      assert.equal(result.admission, 'not_evaluated');
    }
  });

  it('matches an explicitly selected static method and exported-function scope', () => {
    const method = 'static send(value: unknown) {}';
    const sink = `export class Sink { ${method} }`;
    const main = "import { Sink } from './sink.js'; export function run() { Sink.send(1); }";
    const selected = selector(main, 'run', sink, sink.indexOf(method));
    selected.declaration.endOffset = sink.indexOf(method) + method.length;
    selected.declaration.astSha256 = hash(method);
    const result = matcher(projection([selected])).inspect(inputs(main, sink), policy);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].sink.exportName, 'run');
    const wrongScope = matcher(projection([{ ...selected, callsiteScope: { ...selected.callsiteScope, exportName: null } }])).inspect(inputs(main, sink), policy);
    assert.equal(wrongScope.matches.length, 0);
    assert.equal(wrongScope.unclassified.length, 1);
  });

  it('keeps shadowing, changed arity, spreads, computed calls and nested callbacks unclassified', () => {
    const main = ["import { send } from './sink.js';", 'send(1, 2); send(...values);',
      'function other(send: Function) { send(1); }', 'unknown(send(1));',
      'object[method](1); (() => send(1))();', "import('external');"].join('\n');
    const result = matcher(projection([selector(main)])).inspect(inputs(main), policy);
    assert.equal(result.status, 'inspected');
    assert.equal(result.matches.length, 1); // Only the direct send(1) inside an unknown argument.
    assert.equal(result.unclassified.length, 8);
    assert.ok(result.unclassified.some((item: { code: string }) => item.code === 'arity_mismatch'));
    assert.ok(result.unclassified.some((item: { code: string }) => item.code === 'spread_arity'));
    assert.equal(result.flow, 'not_evaluated');
  });

  it('rejects mismatched identities, invalid spans, fixture mappings and ambiguous selections without partial results', () => {
    const main = "import { send } from './sink.js'; send(1);";
    const changes = [
      { ...selector(main), fixtureId: 'FX-wrong' },
      { ...selector(main), declaration: { ...selector(main).declaration, astSha256: '0'.repeat(64) } },
      { ...selector(main), declaration: { ...selector(main).declaration, startOffset: 1 } },
      { ...selector(main), callsiteScope: { ...selector(main).callsiteScope, inputSha256: '0'.repeat(64) } },
    ];
    for (const selected of changes) {
      const result = matcher(projection([selected])).inspect(inputs(main), policy);
      assert.equal(result.status, 'rejected'); assert.deepEqual(result.matches, []);
    }
    const duplicate = { ...selector(main), recordIndex: 1, fixtureId: 'FX-1' };
    assert.equal(matcher(projection([selector(main), duplicate]), 2).inspect(inputs(main), policy).status, 'rejected');
    const changed = inputs(main); changed[2] = record('sink.ts', declarationText + '\n');
    assert.equal(matcher(projection([selector(main)])).inspect(changed, policy).status, 'rejected');
  });

  it('allows distinct declarations in one scope but never matches a same-named local binding', () => {
    const second = 'export function other(value: unknown) {}';
    const sink = declarationText + '\n' + second;
    const main = "import { send, other } from './sink.js'; send(1); other(1);";
    const first = selector(main, null, sink);
    first.declaration.endOffset = declarationText.length;
    first.declaration.astSha256 = hash(declarationText);
    const next = selector(main, null, sink, declarationText.length + 1);
    next.recordIndex = 1; next.fixtureId = 'FX-1';
    assert.equal(matcher(projection([first, next]), 2).inspect(inputs(main, sink), policy).matches.length, 2);
    const shadow = 'function send(value: unknown) {} send(1);';
    const result = matcher(projection([selector(shadow)])).inspect(inputs(shadow), policy);
    assert.equal(result.matches.length, 0);
    assert.equal(result.unclassified.length, 1);
    const missingScope = selector(shadow, 'missing');
    assert.equal(matcher(projection([missingScope])).inspect(inputs(shadow), policy).status, 'rejected');
    const excess = projection(Array(1025).fill(selector(shadow)));
    assert.equal(matcher(excess).inspect(inputs(shadow), policy).status, 'rejected');
  });

  it('captures trusted callback/catalog configuration and supplies frozen inputs, not compiler authority', () => {
    const main = "import { send } from './sink.js'; send(1);";
    const config = { ...catalogs(), selectCurrentDeclarations: (catalog: object, identities: object[]) => {
      assert.ok(Object.isFrozen(catalog) && Object.isFrozen(identities));
      return projection([selector(main)]);
    } };
    const parse = createDirectSinkMatcher(config);
    config.ledgerBytes.fill(0); config.selectCurrentDeclarations = () => projection([]);
    const result = parse.inspect(inputs(main), policy);
    assert.equal(result.matches.length, 1);
    assert.ok(Object.isFrozen(result.matches[0].sink));
    assert.equal(Object.hasOwn(result, 'program'), false);
  });

  it('fails closed on unavailable, async, throwing or malformed selectors and unbound external calls', () => {
    const main = "import { send } from 'external'; send(1);";
    const result = matcher(projection([])).inspect(inputs(main), policy);
    assert.equal(result.matches.length, 0); assert.equal(result.unclassified.length, 1);
    assert.equal(createDirectSinkMatcher(catalogs()).inspect(inputs(main), policy).status, 'unavailable');
    for (const selectCurrentDeclarations of [() => Promise.resolve(projection([])), () => null, () => { throw new Error('secret-canary'); }]) {
      const failed = createDirectSinkMatcher({ ...catalogs(), selectCurrentDeclarations }).inspect(inputs(main), policy);
      assert.equal(failed.status, 'rejected'); assert.doesNotMatch(JSON.stringify(failed), /secret-canary/);
    }
  });
});
