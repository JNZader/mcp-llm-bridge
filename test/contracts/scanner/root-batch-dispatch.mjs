import { canonicalizeJcs, decodePathsBin, encodePathsBin, createArtifactHash, createBindingHash } from '../outward-scanner.mjs';
import { ROOT_PARSERS } from './root-api.mjs';
import { classifyExecutionRoots } from './root-integration.mjs';
import { parsePackageJson } from './package-json.mjs';
import { parsePosixShell } from './posix-shell-validation.mjs';
import { parseGitHubActions } from './github-actions-yaml.mjs';
import { createDockerfileParser } from './dockerfile-validation.mjs';
import { createComposeParser } from './compose-yaml.mjs';

const stop = (code, unavailable = false) => { throw { code, unavailable }; };
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;
const edgeKinds = new Set(['entry', 'command', 'working_directory', 'mount', 'environment', 'image', 'generated_output']);
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function parsedResults(value, roots) {
  if (!Array.isArray(value) || value.length !== roots.length) stop('result_mismatch');
  const expected = new Map(roots.map((root) => [root.path, root]));
  const seen = new Set();
  for (const result of value) {
    if (!keys(result, 'diagnostics,edges,inputSha256,parserId,parserVersion,path,rootKind,status')) stop('invalid_result');
    const root = expected.get(result.path);
    if (!root || seen.has(result.path) || result.status !== 'parsed' || result.rootKind !== root.format ||
      result.parserId !== ROOT_PARSERS[root.format] || result.parserVersion !== 1 || result.inputSha256 !== root.sha256 ||
      !Array.isArray(result.diagnostics) || result.diagnostics.length || !Array.isArray(result.edges)) stop('invalid_result');
    seen.add(result.path);
    for (const edge of result.edges) {
      if (!keys(edge, 'field,kind,target') || !edgeKinds.has(edge.kind) || typeof edge.field !== 'string' || typeof edge.target !== 'string') stop('invalid_result');
    }
    canonicalizeJcs(result);
  }
  return structuredClone(value).sort(byteOrder);
}

// This is a LOCAL verification seam, not a provider admission format or first-run
// bootstrap. The caller must already have admitted the existing snapshot against
// its provider subject and immutable candidate before invoking verify(). Hash
// recomputation checks consistency only. selectExpectedRoots is trusted schema
// composition over that exact manifest, not an independent authority source.
export function createRootBatchDispatcher({ selectExpectedRoots, resolveImage, resolveConfig, adapters = {} } = {}) {
  const project = selectExpectedRoots;
  const registry = new Map(Object.entries({ package_json: parsePackageJson, posix_shell: parsePosixShell,
    github_actions: parseGitHubActions, dockerfile: createDockerfileParser({ resolveImage }),
    compose: createComposeParser({ resolveConfig }), ...adapters }));
  return Object.freeze({ verify(observedRecords, independentlyAdmittedExistingSnapshot) {
    try {
      if (typeof project !== 'function') stop('projector_unavailable', true);
      if (!independentlyAdmittedExistingSnapshot) stop('snapshot_unavailable', true);
      const snapshot = structuredClone(independentlyAdmittedExistingSnapshot);
      if (!(snapshot.pathsBin instanceof Uint8Array) || !snapshot.manifest || typeof snapshot.manifest !== 'object' ||
        Array.isArray(snapshot.manifest) || typeof snapshot.providerSubjectHash !== 'string') stop('invalid_snapshot');
      const authoritative = decodePathsBin(snapshot.pathsBin);
      const artifactHash = createArtifactHash(snapshot.pathsBin, snapshot.manifest);
      if (artifactHash !== snapshot.wp00ArtifactHash || createBindingHash(snapshot.providerSubjectHash, artifactHash) !== snapshot.bindingHash) stop('snapshot_mismatch');
      for (const key of ['wp00ArtifactHash', 'bindingHash']) {
        if (Object.hasOwn(snapshot.manifest, key) && snapshot.manifest[key] !== snapshot[key]) stop('snapshot_mismatch');
      }
      const observed = structuredClone(observedRecords);
      const classification = classifyExecutionRoots(observed);
      if (classification.status !== 'classified') stop('invalid_inventory');
      const observedBin = encodePathsBin(observed.map((record) => ({ ...record, sha256: Buffer.from(record.sha256, 'hex') })));
      if (!Buffer.from(snapshot.pathsBin).equals(observedBin)) stop('inventory_mismatch');
      const roots = classification.roots.filter((root) => root.execution);
      if (roots.some((root) => root.disposition !== 'parser_required' || root.obligations.length)) stop('unresolved_roots');
      const projected = project(freeze(structuredClone(snapshot.manifest)));
      const expectedResults = parsedResults(projected, roots);
      const byPath = new Map(observed.map((record) => [record.path, record]));
      const authorityByPath = new Map(authoritative.map((record) => [record.path, { ...record, sha256: Buffer.from(record.sha256).toString('hex') }]));
      const inventoryPaths = authoritative.map((record) => record.path);
      const results = [];
      for (const root of roots) {
        const parser = registry.get(root.format);
        if (typeof parser !== 'function') stop('parser_unavailable', true);
        const observed = byPath.get(root.path);
        const authority = freeze({ schema: 'wp00-root-authority/v1', bindingHash: snapshot.bindingHash,
          wp00ArtifactHash: snapshot.wp00ArtifactHash, record: authorityByPath.get(root.path), inventoryPaths: [...inventoryPaths] });
        const input = { schema: 'wp00-root-input/v1', rootKind: root.format, path: observed.path, mode: observed.mode,
          length: observed.length, sha256: observed.sha256, bytes: Buffer.from(observed.bytes) };
        const result = parser(input, authority);
        if (result?.status === 'rejected') {
          if (result.diagnostics?.some((diagnostic) => diagnostic.code === 'parser_unavailable')) stop('parser_unavailable', true);
          stop('parser_rejected');
        }
        results.push(result);
      }
      const actual = parsedResults(results, roots);
      if (canonicalizeJcs(actual) !== canonicalizeJcs(expectedResults)) stop('result_mismatch');
      return { status: 'verified', results: actual, coverage: classification.coverage, diagnostics: [] };
    } catch (error) {
      const allowed = ['projector_unavailable', 'snapshot_unavailable', 'invalid_snapshot', 'snapshot_mismatch', 'invalid_inventory',
        'inventory_mismatch', 'unresolved_roots', 'invalid_result', 'result_mismatch', 'parser_unavailable', 'parser_rejected'];
      const code = allowed.includes(error?.code) ? error.code : 'verification_failure';
      return { status: error?.unavailable === true && ['projector_unavailable', 'snapshot_unavailable', 'parser_unavailable'].includes(code) ? 'unavailable' : 'rejected',
        results: [], diagnostics: [{ code, line: null, column: null, field: null }] };
    }
  } });
}
