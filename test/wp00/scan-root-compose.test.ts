import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { createComposeParser, parseCompose } from '../contracts/scanner/compose-yaml.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { canonicalizeJcs } from '../contracts/outward-scanner.mjs';

interface Edge { kind: string; field: string; target: string }
const hash = (value: unknown) => `sha256:${createHash('sha256').update(canonicalizeJcs(value)).digest('hex')}`;
const config = () => ({ os: 'linux', workingDir: '/base', user: '1000', env: { KEEP: 'base' },
  entrypoint: ['echo'], cmd: ['inherited'], healthcheck: null, volumes: [] as string[] });
function admitted(subject: unknown, settings = config()) {
  const imageDigest = `sha256:${'c'.repeat(64)}`, configHash = hash(settings);
  return { schema: 'wp00-compose-config/v1', subject, imageDigest, configHash,
    bindingHash: hash({ subject, imageDigest, configHash }), config: settings };
}
function fixture(source: string) {
  const bytes = Buffer.from(source), path = 'deploy/compose.yml';
  const record = { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return [{ schema: 'wp00-root-input/v1', rootKind: 'compose', ...record, bytes },
    { schema: 'wp00-root-authority/v1', record, inventoryPaths: [path], bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}` }];
}
const parser = createComposeParser({ resolveConfig: (subject: unknown) => admitted(subject) });
const service = (fields: string) => `services:\n  app:\n    image: base\n${fields}\n`;
function accepted(source: string, parse = parser): Edge[] {
  const result = parse(...fixture(source));
  assert.equal(result.status, 'parsed', JSON.stringify(result));
  return result.edges;
}
function rejected(source: string, parse = parser) {
  const result = parse(...fixture(source));
  assert.equal(result.status, 'rejected', source);
  assert.deepEqual(result.edges, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
}
const argv = (fields: string) => JSON.parse(accepted(service(fields)).find((edge) => edge.field.endsWith('/argv'))!.target);

describe('SCAN-ROOT-COMPOSE services with independently trusted configuration', () => {
  it('SCAN-ROOT-13 inventories effective environment/user/workdir/network and short/long mounts', () => {
    const source = service('    user: "2000:2000"\n    working_dir: /app\n    network_mode: none\n    environment:\n      MODE: production\n      COUNT: 12\n    volumes:\n      - ./src:/app:ro\n      - data:/data\n      - type: bind\n        source: ./config\n        target: /config\n        read_only: true\n        bind:\n          create_host_path: false\n      - type: tmpfs\n        target: /tmp') + 'volumes:\n  data:\n';
    const edges = accepted(source);
    assert.ok(edges.some((edge) => edge.field.endsWith('/environment/COUNT') && edge.target === '12'));
    assert.ok(edges.some((edge) => edge.field.endsWith('/environment/KEEP') && edge.target === 'base'));
    assert.ok(edges.some((edge) => edge.kind === 'working_directory' && edge.target === '/app'));
    const mounts = edges.filter((edge) => edge.kind === 'mount').map((edge) => JSON.parse(edge.target));
    assert.equal(mounts[0].source, 'deploy/src');
    assert.equal(mounts[0].readOnly, true);
    assert.equal(mounts[2].createHostPath, false);
    assert.equal(mounts[3].type, 'tmpfs');
  });
  it('preserves null inheritance, explicit empty overrides and non-null entrypoint suppression of image CMD', () => {
    assert.deepEqual(argv('    command: null\n    entrypoint: null'), ['echo', 'inherited']);
    assert.deepEqual(argv('    command: []'), ['echo']);
    assert.deepEqual(argv("    command: ''"), ['echo']);
    assert.deepEqual(argv('    entrypoint: []'), []);
    assert.deepEqual(argv('    entrypoint: printf'), ['printf']);
    assert.deepEqual(argv('    entrypoint: []\n    command: echo explicit'), ['echo', 'explicit']);
    assert.deepEqual(argv('    command:\n      - "$$HOME"\n      - "a;b"\n      - "a b"'), ['echo', '$HOME', 'a;b', 'a b']);
  });
  it('validates only explicit shell execution without reinterpreting ordinary command arguments', () => {
    accepted(service("    entrypoint: []\n    command: sh -c 'echo \"$$KEEP\" && printf ok'"));
    rejected(service("    entrypoint: []\n    command: sh -c 'eval \"$$INPUT\"'"));
    rejected(service('    entrypoint: node\n    command:\n      - --eval\n      - secret-canary'));
    const edges = accepted(service('    command:\n      - "$$(touch sentinel)"'));
    assert.equal(edges.some((edge) => edge.kind === 'entry' && edge.target === 'touch'), false);
  });
  it('normalizes build-only identity and rejects image/build ambiguity without invoking real builds', () => {
    const subjects: unknown[] = [];
    const parse = createComposeParser({ resolveConfig: (subject: unknown) => { subjects.push(subject); return admitted(subject); } });
    accepted('services:\n  app:\n    build:\n      context: ./app\n      dockerfile: Dockerfile.prod\n      target: release\n', parse);
    assert.deepEqual(subjects, [{ kind: 'build', context: 'deploy/app', dockerfile: 'deploy/app/Dockerfile.prod', target: 'release' }]);
    accepted('services:\n  app:\n    build: .\n', parse);
    rejected(service('    build: .'), parse);
    rejected('services:\n  app:\n    build: ../escape\n', parse);
  });
  it('fails closed for missing, asynchronous, mismatched, healthcheck or inherited-volume metadata', () => {
    rejected(service(''), parseCompose);
    const bad = [(subject: unknown) => Promise.resolve(admitted(subject)), (subject: unknown) => ({ ...admitted(subject), bindingHash: hash({}) }),
      () => admitted({ kind: 'image', reference: 'wrong' }), (subject: unknown) => admitted(subject, { ...config(), volumes: ['/hidden'] })];
    for (const resolveConfig of bad) rejected(service(''), createComposeParser({ resolveConfig }));
    const args = fixture(service(''));
    assert.equal(parser(args[0], { ...args[1], record: { ...args[1]?.record, sha256: 'd'.repeat(64) } }).status, 'rejected');
  });
  it('SCAN-ROOT-14 rejects duplicate/unknown fields, aliases, host environment, unsafe binds and network cycles atomically', () => {
    for (const fields of ['    environment:\n      - HOST_INPUT', '    environment:\n      INPUT:', '    environment:\n      - X=one\n      - X=two',
      '    command: "${secret-canary}"', '    command: &x echo', '    command: *x', '    privileged: true', '    x-execution: secret-canary',
      '    command: echo first\n    command: echo second', '    volumes:\n      - /etc:/host', '    volumes:\n      - ../escape:/host',
      '    volumes:\n      - missing:/data', '    network_mode: container:other', '    network_mode: service:app']) rejected(service(fields));
    accepted('services:\n  app:\n    image: base\n    network_mode: service:side\n  side:\n    image: base\n');
    rejected(service('    network_mode: compose-default'));
    rejected('services:\n  app:\n    image: base\n    network_mode: service:side\n  side:\n    image: base\n    network_mode: service:app\n');
  });
});
