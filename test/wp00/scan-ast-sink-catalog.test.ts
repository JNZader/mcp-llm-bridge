import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { decodeHistoricalSinkCatalog, CATALOG_LIMITS } from '../contracts/scanner/typescript-sink-catalog.mjs';

// Extract fenced data only, never discover sinks by matching source text.
function embedded(path: string, schema: string) {
  const lines = readFileSync(new URL(`../../openspec/changes/containment-and-evidence-harness/${path}`, import.meta.url), 'utf8').split('\n');
  const matches: string[] = [];
  let block: string[] | null = null;
  for (const line of lines) {
    if (line.trim() === '```json') { block = []; continue; }
    if (line.trim() === '```' && block) {
      const text = block.join('\n');
      if (JSON.parse(text).schema === schema) matches.push(text);
      block = null;
    } else if (block) block.push(line);
  }
  assert.equal(matches.length, 1);
  return matches[0]!;
}
const ledgerText = embedded('design/baseline-ledger.md', 'wp00-baseline-ledger/v3');
const fixtureText = embedded('design/contracts.md', 'wp00-fixture-catalog/v3');
const decode = (ledger = ledgerText, fixtures = fixtureText) => decodeHistoricalSinkCatalog(Buffer.from(ledger), Buffer.from(fixtures));
interface TestCompleteness { records: number; byOwner: Record<string, number> }
interface TestLedger {
  records: (number | string | null)[][]; fixtures: string[]; signatures: string[];
  completeness: TestCompleteness; unrecognized?: string;
}
interface TestFixtures {
  protocolProjectionRuns: number[][]; addedEvidence: (number | string)[][];
  sourceEvidenceDigest: string;
}
function rejectMutation(change: (ledger: TestLedger, fixtures: TestFixtures) => void) {
  const ledger = JSON.parse(ledgerText) as TestLedger;
  const fixtures = JSON.parse(fixtureText) as TestFixtures;
  change(ledger, fixtures);
  const result = decode(JSON.stringify(ledger), JSON.stringify(fixtures));
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.expectations, []);
  assert.deepEqual(result.diagnostics, [{ code: 'invalid_catalog' }]);
}

describe('Historical AST sink catalog, not current-source matching', () => {
  it('decodes the actual 660 expectations and verifies only the 107 bound expression payloads', () => {
    const result = decode();
    assert.equal(result.status, 'decoded');
    assert.equal(result.expectations.length, 660);
    assert.equal(result.expressionEvidenceCount, 107);
    assert.equal(result.sourceEvidenceDigest, 'sha256:698539835b87ce43208444d994a11ce6670d638ba4f655bd6e61261676072c75');
    assert.equal(result.source.commit, 'f1ad14f6ae8037a52c705838f4bf1d2b9bac766b');
    assert.equal(result.currentSource, 'not_evaluated');
    assert.equal(result.admission, 'not_evaluated');
    assert.equal(result.expectations[114].fixtureId, 'FX-R18-0250DBB1');
    assert.deepEqual(result.expectations[114].sink, {
      path: 'src/core/router-telemetry.ts', module: 'src/core/router-telemetry.ts', startLine: 190, endLine: 190,
      exportName: 'recordUsage', callee: 'field:errorMessage', arity: 1, signatureId: 'DURABLE-FIELD',
      ownerUnit: 'LOG-ROUTER', disposition: 'redact_or_code_only',
    });
    assert.equal(result.expectations[0].expressionEvidence, null);
    assert.ok(Object.isFrozen(result.expectations[114].sink));
    assert.deepEqual(decode(), result);
  });

  it('rejects invalid indices, tuple shapes, duplicate IDs and conflicting loci', () => {
    rejectMutation((ledger) => { ledger.records[0]![0] = 999999; });
    rejectMutation((ledger) => { ledger.records[0]!.push(1); });
    rejectMutation((ledger) => { ledger.fixtures[1] = ledger.fixtures[0]!; });
    rejectMutation((ledger) => { ledger.signatures[1] = ledger.signatures[0]!; });
    rejectMutation((ledger) => { ledger.records[1] = [...ledger.records[0]!]; ledger.records[1]![9] = 1; ledger.records[1]![7] = 0; });
    rejectMutation((ledger) => { ledger.records[0]![1] = 0; });
  });

  it('rejects missing or overlapping fixture joins and inconsistent summary counts', () => {
    rejectMutation((_ledger, fixtures) => { fixtures.protocolProjectionRuns.shift(); });
    rejectMutation((_ledger, fixtures) => { fixtures.protocolProjectionRuns.push(fixtures.protocolProjectionRuns[0]!); });
    rejectMutation((ledger) => { ledger.completeness.records--; });
    rejectMutation((ledger) => { ledger.completeness.byOwner['LOG-ROUTER'] = ledger.completeness.byOwner['LOG-ROUTER']! + 1; });
  });

  it('rejects changed expression evidence without remapping stable fixture identities', () => {
    rejectMutation((_ledger, fixtures) => { fixtures.addedEvidence[0]![4] = Buffer.from('changed').toString('base64'); });
    rejectMutation((_ledger, fixtures) => { fixtures.addedEvidence[0]![1] = Number(fixtures.addedEvidence[0]![1]) + 1; });
    rejectMutation((_ledger, fixtures) => { fixtures.addedEvidence.push(fixtures.addedEvidence[0]!); });
    rejectMutation((_ledger, fixtures) => { fixtures.sourceEvidenceDigest = `sha256:${'0'.repeat(64)}`; });
    assert.equal(decode().expectations[114].fixtureId, 'FX-R18-0250DBB1');
  });

  it('fails closed on duplicate JSON, invalid UTF-8, unknown schema fields and input limits', () => {
    assert.equal(decode('{"schema":"x","schema":"y"}').status, 'rejected');
    assert.equal(decodeHistoricalSinkCatalog(Buffer.from([255]), Buffer.from(fixtureText)).status, 'rejected');
    assert.equal(decodeHistoricalSinkCatalog(Buffer.alloc(CATALOG_LIMITS.bytes + 1), Buffer.from(fixtureText)).status, 'rejected');
    rejectMutation((ledger) => { ledger.unrecognized = 'secret-canary'; });
  });
});
