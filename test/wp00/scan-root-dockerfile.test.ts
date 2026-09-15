import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { createDockerfileParser, parseDockerfile } from '../contracts/scanner/dockerfile-validation.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { canonicalizeJcs } from '../contracts/outward-scanner.mjs';

interface Edge { kind: string; field: string; target: string }
const hash = (value: unknown) => `sha256:${createHash('sha256').update(canonicalizeJcs(value)).digest('hex')}`;
const config = () => ({ os: 'linux', platform: 'linux/amd64', shell: ['/bin/sh', '-c'], workingDir: '/', user: '',
  env: { HOME: '/root' }, entrypoint: [] as string[], cmd: [] as string[], onbuild: [] as string[], healthcheck: null });
function admitted(reference: string, settings = config()) {
  const imageDigest = `sha256:${'c'.repeat(64)}`;
  const configHash = hash(settings);
  return { schema: 'wp00-docker-image-config/v1', reference, imageDigest, configHash,
    bindingHash: hash({ reference, imageDigest, configHash }), config: settings };
}
function fixture(source: string) {
  const bytes = Buffer.from(source);
  const path = 'Dockerfile';
  const record = { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  return [{ schema: 'wp00-root-input/v1', rootKind: 'dockerfile', ...record, bytes },
    { schema: 'wp00-root-authority/v1', record, inventoryPaths: [path], bindingHash: `sha256:${'a'.repeat(64)}`, wp00ArtifactHash: `sha256:${'b'.repeat(64)}` }];
}
const parser = createDockerfileParser({ resolveImage: (ref: string) => admitted(ref) });
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

describe('SCAN-ROOT-DOCKER semantics with separately trusted configuration', () => {
  it('SCAN-ROOT-11 resolves ENV, WORKDIR, USER, COPY/ADD and previous-stage inheritance', () => {
    const source = 'FROM base AS build\nENV ROOT=/app MODE="production"\nWORKDIR $ROOT\nUSER 1000:1000\nCOPY --chown=1000:1000 --chmod=0755 ["source file","./"]\nADD archive.tar ./\nRUN echo "$MODE"\nFROM build AS final\nCOPY --from=0 /app/output /out/\nCMD ["echo","ok"]';
    const edges = accepted(source);
    assert.ok(edges.some((edge) => edge.kind === 'working_directory' && edge.target === '/app'));
    assert.ok(edges.some((edge) => edge.field.includes('/COPY/stage:0/') && edge.target === '/app/output'));
    assert.ok(edges.some((edge) => edge.field.endsWith('/user') && edge.target === '1000:1000'));
    assert.ok(edges.some((edge) => edge.field.includes('/ADD/destination') && edge.target === '/app'));
  });
  it('combines JSON CMD arguments with ENTRYPOINT without expanding literal JSON arguments', () => {
    const edges = accepted('FROM base\nENTRYPOINT ["echo"]\nCMD ["$HOME","$(touch sentinel)","a;b","a b"]');
    const runtime = edges.find((edge) => edge.field.endsWith('/runtime'));
    assert.deepEqual(JSON.parse(runtime!.target), ['echo', '$HOME', '$(touch sentinel)', 'a;b', 'a b']);
    assert.equal(edges.some((edge) => edge.kind === 'entry' && edge.target === 'touch'), false);
    rejected('FROM base\nENTRYPOINT ["node"]\nCMD ["--eval","secret-canary"]');
    rejected('FROM base\nRUN ["sh","-c","eval \\\"$INPUT\\\""]');
  });
  it('honors inherited entrypoints, local ENTRYPOINT reset and shell-form execution', () => {
    const inherited = createDockerfileParser({ resolveImage: (ref: string) => admitted(ref, { ...config(), entrypoint: ['echo'], cmd: ['old'] }) });
    const edges = accepted('FROM base\nCMD ["new"]', inherited);
    assert.deepEqual(JSON.parse(edges.find((edge) => edge.field.endsWith('/runtime'))!.target), ['echo', 'new']);
    const reset = accepted('FROM base\nENTRYPOINT ["printf"]', inherited);
    assert.deepEqual(JSON.parse(reset.find((edge) => edge.field.endsWith('/runtime'))!.target), ['printf']);
    assert.ok(accepted('FROM base\nRUN echo build\nCMD echo runtime').some((edge) => edge.target === '["/bin/sh","-c","echo runtime"]'));
    rejected('FROM base\nCMD eval "$INPUT"');
  });
  it('fails closed for missing, asynchronous, inconsistent or execution-bearing base metadata', () => {
    rejected('FROM base\nRUN echo ok', parseDockerfile);
    const badResolvers = [() => null, () => Promise.resolve(admitted('base')), () => ({ ...admitted('base'), bindingHash: hash({}) }),
      () => admitted('wrong'), () => admitted('base', { ...config(), onbuild: ['RUN secret-canary'] }),
      () => admitted('base', { ...config(), os: 'windows' }), () => admitted('base', { ...config(), shell: ['pwsh', '-c'] })];
    for (const resolveImage of badResolvers) rejected('FROM base\nRUN echo ok', createDockerfileParser({ resolveImage }));
    rejected(`FROM base@sha256:${'d'.repeat(64)}\nRUN echo ok`);
  });
  it('SCAN-ROOT-12 rejects dynamic stages/paths, unsafe commands and unknown flags without partial edges', () => {
    for (const instruction of ['COPY $MISSING /app', 'COPY ../escape /app', 'COPY --from=$STAGE /a /b',
      'COPY --from=unknown /a /b', 'COPY --chmod=$MODE /a /b', 'ADD https://example.com/a /app',
      'WORKDIR ${ROOT:-/app}', 'RUN eval "$INPUT"', 'ENV X=one X=two', 'COPY *.js /app/', 'USER $MISSING']) {
      rejected(`FROM base\nRUN echo safe\n${instruction}`);
    }
    rejected('FROM $BASE\nRUN echo ok');
    rejected('FROM base AS same\nFROM base AS same');
    rejected('FROM base AS first\nENV ROOT=/one\nFROM base\nWORKDIR $ROOT');
  });
});
