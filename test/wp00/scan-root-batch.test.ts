import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { createRootBatchDispatcher } from '../contracts/scanner/root-batch-dispatch.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { encodePathsBin, createArtifactHash, createBindingHash } from '../contracts/outward-scanner.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { parsePackageJson } from '../contracts/scanner/package-json.mjs';

function record(path: string, source: string) {
  const bytes = Buffer.from(source);
  return { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
function fixture(records = [record('package.json', '{"main":"index.js"}'), record('run.sh', 'echo ok'), record('README.md', 'passive')]) {
  // Independently specified expected results: never obtained from the dispatcher.
  const roots = records.filter((item) => item.path !== 'README.md').map((item) => ({ status: 'parsed', path: item.path,
    rootKind: item.path === 'package.json' ? 'package_json' : 'posix_shell',
    parserId: item.path === 'package.json' ? 'package-json-v1' : 'posix-shell-v1', parserVersion: 1, inputSha256: item.sha256,
    edges: item.path === 'package.json' ? [{ kind: 'entry', field: '/main', target: 'index.js' }] :
      [{ kind: 'entry', field: '/shell/0', target: 'echo' }, { kind: 'command', field: '/shell/1', target: 'echo ok' }], diagnostics: [] }));
  const pathsBin = encodePathsBin(records.map((item) => ({ ...item, sha256: Buffer.from(item.sha256, 'hex') })));
  const manifest = { fixtureVersion: 1, roots };
  const wp00ArtifactHash = createArtifactHash(pathsBin, manifest), providerSubjectHash = 'independently-admitted-fixture';
  return { records, snapshot: { pathsBin, manifest, providerSubjectHash, wp00ArtifactHash, bindingHash: createBindingHash(providerSubjectHash, wp00ArtifactHash) } };
}
interface Manifest { roots: unknown[] }
const dispatcher = createRootBatchDispatcher({ selectExpectedRoots: (manifest: Manifest) => manifest.roots });
const failed = (result: { status: string; results: unknown[] }) => {
  assert.notEqual(result.status, 'verified');
  assert.deepEqual(result.results, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
};

describe('SCAN-ROOT trusted existing-snapshot batch verification, not provider admission', () => {
  it('verifies actual package and shell adapters against independently specified hash-bound results', () => {
    const { records, snapshot } = fixture();
    const result = dispatcher.verify(records, snapshot);
    assert.equal(result.status, 'verified', JSON.stringify(result));
    assert.deepEqual(result.coverage, { observed: 3, execution: 2, passive: 1 });
    assert.deepEqual(result, dispatcher.verify([...records].reverse(), snapshot));
    assert.equal(Object.hasOwn(result, 'bindingHash'), false);
  });
  it('checks entire inventory including passive content, modes, missing records and duplicate paths', () => {
    const { records, snapshot } = fixture();
    for (const changed of [records.slice(0, 2), [...records, records[0]], [{ ...records[0], mode: 0o100755 }, ...records.slice(1)],
      [...records.slice(0, 2), record('README.md', 'changed')], [record('renamed.json', '{}'), ...records.slice(1)]]) failed(dispatcher.verify(changed, snapshot));
    failed(dispatcher.verify(records, { ...snapshot, bindingHash: `sha256:${'d'.repeat(64)}` }));
    failed(dispatcher.verify(records, { ...snapshot, manifest: { ...snapshot.manifest, fixtureVersion: 2 } }));
  });
  it('requires a projector over detached deeply frozen manifest and captures adapter registration', () => {
    const { records, snapshot } = fixture();
    const adapters = { package_json: parsePackageJson };
    const selected = createRootBatchDispatcher({ adapters, selectExpectedRoots: (manifest: Manifest) => {
      assert.equal(Object.isFrozen(manifest), true);
      assert.equal(Object.isFrozen(manifest.roots), true);
      return manifest.roots;
    } });
    adapters.package_json = () => { throw new Error('secret-canary'); };
    assert.equal(selected.verify(records, snapshot).status, 'verified');
    assert.equal(createRootBatchDispatcher().verify(records, snapshot).status, 'unavailable');
    const mutating = createRootBatchDispatcher({ selectExpectedRoots: (manifest: Manifest) => { manifest.roots.push({}); return manifest.roots; } });
    failed(mutating.verify(records, snapshot));
    assert.equal(snapshot.manifest.roots.length, 2);
  });
  it('rejects malformed, duplicate, asynchronous or differing expected results and parser exceptions', () => {
    const { records, snapshot } = fixture();
    for (const selectExpectedRoots of [() => Promise.resolve([]), () => [{ extra: true }],
      (manifest: Manifest) => [manifest.roots[0], manifest.roots[0]], () => { throw new Error('secret-canary'); }]) {
      failed(createRootBatchDispatcher({ selectExpectedRoots }).verify(records, snapshot));
    }
    const changed = structuredClone(snapshot);
    changed.manifest.roots[0]!.edges[0]!.target = 'different.js';
    changed.wp00ArtifactHash = createArtifactHash(changed.pathsBin, changed.manifest);
    changed.bindingHash = createBindingHash(changed.providerSubjectHash, changed.wp00ArtifactHash);
    failed(dispatcher.verify(records, changed));
    failed(createRootBatchDispatcher({ selectExpectedRoots: (manifest: Manifest) => manifest.roots, adapters: { package_json: () => { throw new Error('secret-canary'); } } }).verify(records, snapshot));
  });
  it('never skips AST/generated/config roots and reports missing adapters or image resolvers without partial success', () => {
    for (const path of ['source.ts', 'docs/assets/app.js', '.devcontainer/devcontainer.json']) {
      const { records, snapshot } = fixture([record(path, '')]);
      failed(dispatcher.verify(records, snapshot));
    }
    const { records, snapshot } = fixture();
    const missing = createRootBatchDispatcher({ selectExpectedRoots: (manifest: Manifest) => manifest.roots, adapters: { posix_shell: null } });
    assert.equal(missing.verify(records, snapshot).status, 'unavailable');
    const docker = fixture([record('Dockerfile', 'FROM base\nRUN echo ok')]);
    docker.snapshot.manifest.roots[0]!.rootKind = 'dockerfile';
    docker.snapshot.manifest.roots[0]!.parserId = 'dockerfile-v1';
    docker.snapshot.wp00ArtifactHash = createArtifactHash(docker.snapshot.pathsBin, docker.snapshot.manifest);
    docker.snapshot.bindingHash = createBindingHash(docker.snapshot.providerSubjectHash, docker.snapshot.wp00ArtifactHash);
    assert.equal(dispatcher.verify(docker.records, docker.snapshot).status, 'unavailable');
  });
});
