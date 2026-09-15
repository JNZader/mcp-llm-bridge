import { createHash } from 'node:crypto';
import { canonicalizeJcs, encodePathsBin } from '../outward-scanner.mjs';
import { parseStrictJson } from './package-json.mjs';

export const CATALOG_LIMITS = Object.freeze({ bytes: 4_194_304, records: 10_000, text: 65_536 });
const fields = ['pathId', 'startLine', 'endLine', 'exportNameOrNull', 'calleeId', 'arity', 'signatureId', 'ownerUnitId', 'dispositionId', 'fixtureId'];
const normalization = 'ts-expression-slice-lf/v1';
const aggregateSchema = 'wp00-added-evidence-preimage/v1';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stop = () => { throw new Error('invalid_catalog'); };
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= CATALOG_LIMITS.text && !/[\x00-\x1f]/.test(value);
const same = (left, right) => canonicalizeJcs(left) === canonicalizeJcs(right);
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !same(Object.keys(value).sort(), expected.split(' ').sort())) stop();
}
function list(value) {
  if (!Array.isArray(value) || value.length > CATALOG_LIMITS.records) stop();
  return value;
}
function dictionary(value) {
  list(value);
  if (!value.every(text) || new Set(value).size !== value.length) stop();
}
function at(values, index) {
  if (!integer(index) || index >= values.length) stop();
  return values[index];
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Decodes historical expectations only. Hash consistency is not prior source
// admission, current call-site matching, or proof of the claimed disposition.
// Only addedEvidence rows carry expression hashes; all other evidence is null.
export function decodeHistoricalSinkCatalog(ledgerBytes, fixtureBytes) {
  try {
    if (![ledgerBytes, fixtureBytes].every((bytes) => bytes instanceof Uint8Array && bytes.byteLength <= CATALOG_LIMITS.bytes)) stop();
    const ledger = parseStrictJson(Buffer.from(ledgerBytes)), fixtures = parseStrictJson(Buffer.from(fixtureBytes));
    keys(ledger, 'schema source fields paths callees signatures ownerUnits dispositions fixtures records completeness');
    keys(fixtures, 'schema join protocols projections protocolProjectionRuns normalizationVersion aggregateSchema sourceEvidenceDigest addedEvidence entryCount');
    keys(ledger.source, 'grade commit parser inclusion discovery');
    if (ledger.schema !== 'wp00-baseline-ledger/v3' || fixtures.schema !== 'wp00-fixture-catalog/v3' ||
      ledger.source.grade !== 'read' || ledger.source.parser !== 'typescript@5.9.3' ||
      !/^[0-9a-f]{40}$/.test(ledger.source.commit) || !text(ledger.source.inclusion) || !text(ledger.source.discovery) ||
      !same(ledger.fields, fields) || fixtures.normalizationVersion !== normalization || fixtures.aggregateSchema !== aggregateSchema ||
      fixtures.join !== 'record index i => fixtureId=ledger.fixtures[i]; protocol/projection from covering run [first,last,protocolId,projectionId]; addedEvidence=[recordIndex,startOffset,endOffset,payloadSha256,payloadBase64]') stop();
    for (const name of ['paths', 'callees', 'signatures', 'ownerUnits', 'dispositions', 'fixtures']) dictionary(ledger[name]);
    dictionary(fixtures.protocols); dictionary(fixtures.projections);
    if (ledger.paths.some((path) => /(?:^|\/)(?:test|__tests__|fixtures|preloads)\//.test(path) || /\.(?:test|spec)\./.test(path))) stop();
    // This exclusion belongs to the historical ledger, not execution inventory.
    encodePathsBin(ledger.paths.map((path) => ({ path, mode: 0o100644, length: 0n, sha256: Buffer.alloc(32) })));
    list(ledger.records); list(fixtures.protocolProjectionRuns); list(fixtures.addedEvidence);
    const count = ledger.records.length;
    if (fixtures.entryCount !== count || ledger.fixtures.length !== count) stop();
    const joins = new Map();
    for (const run of fixtures.protocolProjectionRuns) {
      if (!Array.isArray(run) || run.length !== 4) stop();
      const [first, last, protocolId, projectionId] = run;
      if (!integer(first) || !integer(last) || first > last || last >= count) stop();
      const protocol = at(fixtures.protocols, protocolId), projection = at(fixtures.projections, projectionId);
      for (let index = first; index <= last; index++) {
        if (joins.has(index)) stop();
        joins.set(index, { protocol, projection });
      }
    }
    if (joins.size !== count) stop();
    const observedLoci = new Set(), bySignature = {}, byOwner = {}, usedPaths = new Set();
    const expectations = ledger.records.map((row, recordIndex) => {
      if (!Array.isArray(row) || row.length !== fields.length) stop();
      const [pathId, startLine, endLine, exportName, calleeId, arity, signatureId, ownerId, dispositionId, fixtureId] = row;
      if (!integer(startLine) || startLine < 1 || !integer(endLine) || endLine < startLine || !integer(arity) ||
        (exportName !== null && !text(exportName)) || fixtureId !== recordIndex) stop();
      const path = at(ledger.paths, pathId), callee = at(ledger.callees, calleeId);
      // Different callees/observations can share lines. Conflict means the same
      // complete historical locus, including export, callee and arity, recurs.
      const locus = canonicalizeJcs([path, startLine, endLine, exportName, callee, arity]);
      if (observedLoci.has(locus)) stop();
      observedLoci.add(locus); usedPaths.add(path);
      const signature = at(ledger.signatures, signatureId), ownerUnit = at(ledger.ownerUnits, ownerId);
      const disposition = at(ledger.dispositions, dispositionId), join = joins.get(recordIndex);
      if (join.projection !== disposition) stop();
      bySignature[signature] = (bySignature[signature] ?? 0) + 1;
      byOwner[ownerUnit] = (byOwner[ownerUnit] ?? 0) + 1;
      return { recordIndex, fixtureId: at(ledger.fixtures, fixtureId), ...join,
        sink: { path, startLine, endLine, module: path, exportName, callee, arity, signatureId: signature, ownerUnit, disposition },
        expressionEvidence: null };
    });
    const completeness = ledger.completeness;
    keys(completeness, 'records paths bySignature byOwner regeneratedAdditions sourceEvidenceDigest addedEvidenceNormalizationVersion sourceEvidenceDigestSchema sourceEvidenceDigestCoverage');
    keys(completeness.regeneratedAdditions, 'durable helperCalls');
    if (completeness.records !== count || completeness.paths !== ledger.paths.length || usedPaths.size !== ledger.paths.length ||
      !same(completeness.bySignature, bySignature) || !same(completeness.byOwner, byOwner) ||
      completeness.addedEvidenceNormalizationVersion !== normalization || completeness.sourceEvidenceDigestSchema !== aggregateSchema ||
      completeness.sourceEvidenceDigestCoverage !== fixtures.addedEvidence.length) stop();
    const seenEvidence = new Set(), preimage = [];
    let durable = 0, helperCalls = 0;
    for (const row of fixtures.addedEvidence) {
      if (!Array.isArray(row) || row.length !== 5) stop();
      const [index, startOffset, endOffset, payloadSha256, payloadBase64] = row;
      const expectation = at(expectations, index);
      if (seenEvidence.has(index) || !integer(startOffset) || !integer(endOffset) || endOffset <= startOffset ||
        !/^[0-9a-f]{64}$/.test(payloadSha256) || typeof payloadBase64 !== 'string') stop();
      seenEvidence.add(index);
      const payload = Buffer.from(payloadBase64, 'base64');
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      if (payload.toString('base64') !== payloadBase64 || hash(payload) !== payloadSha256 || decoded.includes('\r')) stop();
      const evidence = { startOffset, endOffset, payloadSha256, payloadBase64, normalizationVersion: normalization };
      expectation.expressionEvidence = evidence;
      preimage.push({ recordIndex: index, path: expectation.sink.path, ...evidence });
      if (expectation.sink.signatureId === 'DURABLE-FIELD') durable++;
      else if (['H-HELPER', 'MCP-HELPER'].includes(expectation.sink.signatureId)) helperCalls++;
      else stop();
    }
    preimage.sort((left, right) => left.recordIndex - right.recordIndex);
    const digest = `sha256:${hash(Buffer.from(canonicalizeJcs(preimage)))}`;
    if (digest !== fixtures.sourceEvidenceDigest || digest !== completeness.sourceEvidenceDigest ||
      completeness.regeneratedAdditions.durable !== durable || completeness.regeneratedAdditions.helperCalls !== helperCalls) stop();
    return freeze({ schema: 'wp00-historical-sinks/v1', status: 'decoded', evidence: 'historical_expectations',
      admission: 'not_evaluated', currentSource: 'not_evaluated', source: ledger.source,
      expectations, expressionEvidenceCount: seenEvidence.size, sourceEvidenceDigest: digest, diagnostics: [] });
  } catch {
    return freeze({ schema: 'wp00-historical-sinks/v1', status: 'rejected', expectations: [],
      admission: 'not_evaluated', currentSource: 'not_evaluated', diagnostics: [{ code: 'invalid_catalog' }] });
  }
}
