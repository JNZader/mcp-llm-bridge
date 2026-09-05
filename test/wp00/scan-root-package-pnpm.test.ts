import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { parsePackageJson } from '../contracts/scanner/package-json.mjs';

interface Edge { kind: string; field: string; target: string }
function parse(source: string, path = 'package.json') {
  const bytes = Buffer.from(source);
  const record = { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return parsePackageJson({ schema: 'wp00-root-input/v1', rootKind: 'package_json', ...record, bytes },
    { schema: 'wp00-root-authority/v1', record, inventoryPaths: [path], bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}` });
}
function policy(source: string) {
  const result = parse(source);
  assert.equal(result.status, 'parsed', JSON.stringify(result));
  return result.edges.filter((edge: Edge) => edge.field.startsWith('/pnpm/'));
}
function rejected(source: string, path?: string) {
  const result = parse(source, path);
  assert.equal(result.status, 'rejected', source);
  assert.deepEqual(result.edges, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
}

describe('Root pnpm 9 bounded package policy', () => {
  it('parses the actual repository package with real shell validation and independently expected policy edges', () => {
    const source = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    assert.deepEqual(policy(source), [
      { kind: 'environment', field: '/pnpm/onlyBuiltDependencies', target: '["better-sqlite3","esbuild"]' },
      { kind: 'environment', field: '/pnpm/overrides/sharp', target: '0.34.5' },
    ]);
    assert.ok(parse(source).edges.some((edge: Edge) => edge.field === '/scripts/test' && edge.kind === 'command'));
  });
  it('distinguishes an absent policy from an explicitly empty build allowlist', () => {
    assert.deepEqual(policy('{}'), []);
    assert.deepEqual(policy('{"pnpm":{}}'), []);
    assert.deepEqual(policy('{"pnpm":{"onlyBuiltDependencies":[]}}'), [
      { kind: 'environment', field: '/pnpm/onlyBuiltDependencies', target: '[]' },
    ]);
    assert.deepEqual(policy('{"pnpm":{"overrides":{}}}'), [{ kind: 'environment', field: '/pnpm/overrides', target: '{}' }]);
  });
  it('supports scoped package names and exact stable versions without solving or executing dependencies', () => {
    assert.deepEqual(policy('{"pnpm":{"overrides":{"@scope/pkg":"1.2.3"},"onlyBuiltDependencies":["@scope/pkg"]}}'), [
      { kind: 'environment', field: '/pnpm/onlyBuiltDependencies', target: '["@scope/pkg"]' },
      { kind: 'environment', field: '/pnpm/overrides/@scope~1pkg', target: '1.2.3' },
    ]);
    rejected('{"main":"index.js","scripts":{"start":"eval \\\"$INPUT\\\""},"pnpm":{"onlyBuiltDependencies":[]}}');
    rejected('{"pnpm":{"onlyBuiltDependencies":["node_modules"]}}');
  });
  it('rejects malformed policy, duplicate keys/names and unsupported execution settings without partial edges', () => {
    for (const pnpm of [null, [], { onlyBuiltDependencies: 'pkg' }, { onlyBuiltDependencies: ['pkg', 'pkg'] },
      { onlyBuiltDependencies: ['../secret-canary'] }, { onlyBuiltDependencies: ['@scope/'] }, { onlyBuiltDependencies: ['UpperCase'] },
      { overrides: [] }, { overrides: { pkg: null } }, { neverBuiltDependencies: [] }, { onlyBuiltDependenciesFile: 'policy.json' },
      { patchedDependencies: { pkg: 'patch.diff' } }]) rejected(JSON.stringify({ main: 'index.js', pnpm }));
    rejected('{"pnpm":{"overrides":{"pkg":"1.2.3","pkg":"2.0.0"}}}');
    rejected('{"pnpm":{"onlyBuiltDependencies":[],"onlyBuiltDependencies":[]}}');
    rejected('{"pnpm":{"onlyBuiltDependencies":[]}}', 'nested/package.json');
  });
  it('rejects dynamic/protocol/range/parent selectors and does not mistake them for resolved provenance', () => {
    for (const replacement of ['$pkg', '${INPUT}', '^1.2.3', 'latest', '01.2.3', '1x2x3', '1.2.3-beta', '-',
      'file:../secret-canary', 'git+https://example.com/pkg', 'https://example.com/pkg.tgz', 'npm:other@1.2.3']) {
      rejected(JSON.stringify({ pnpm: { overrides: { pkg: replacement } } }));
    }
    for (const selector of ['parent>pkg', 'pkg@^1', '../pkg', '@scope', '$pkg']) {
      rejected(JSON.stringify({ pnpm: { overrides: { [selector]: '1.2.3' } } }));
    }
  });
});
