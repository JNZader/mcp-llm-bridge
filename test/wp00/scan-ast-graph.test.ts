import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import ts from 'typescript';
// @ts-expect-error Deliberate internal ESM JavaScript scanner seam.
import { createNodeNextProgramContext } from '../contracts/scanner/typescript-program.mjs';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { inspectNodeNextModuleGraph } from '../contracts/scanner/typescript-graph.mjs';

function record(path: string, text: string) {
  const bytes = Buffer.from(text);
  return { path, mode: 0o100644, length: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
const scope = () => record('package.json', '{"type":"module"}');
const inspect = (records: unknown[]) => inspectNodeNextModuleGraph(records, 'nodenext-explicit-v1');
interface Issue { code: string }
interface Binding { localName: string; origins: { path: string; startOffset: number; endOffset: number }[] }

describe('Explicit inventory-only NodeNext ESM module graph', () => {
  it('resolves real checker aliases through relative reexports with exact origin spans', () => {
    const definition = 'export const original = 1;';
    const inputs = [scope(), record('src/value.ts', definition),
      record('src/barrel.ts', "export { original as renamed } from './value.js';"),
      record('src/main.ts', "import { renamed as local } from './barrel.js'; export { local }; const x = import('./value.js');")];
    const result = inspect(inputs);
    assert.equal(result.status, 'inspected');
    assert.equal(result.closed, true);
    assert.equal(result.admission, 'not_evaluated');
    assert.equal(result.semanticTypecheck, 'not_evaluated');
    assert.deepEqual(result.edges.map((edge: { target: string }) => edge.target), ['src/value.ts', 'src/barrel.ts', 'src/value.ts']);
    const binding = result.bindings.find((item: Binding) => item.localName === 'local') as Binding;
    assert.equal(binding.origins[0]?.path, 'src/value.ts');
    const origin = binding.origins[0]!;
    assert.equal(definition.slice(origin.startOffset, origin.endOffset), 'original = 1');
    const before = result.edges[0].target;
    inputs[1]!.bytes.fill(0);
    assert.equal(result.edges[0].target, before);
    assert.ok(Object.isFrozen(result.edges[0]));
  });

  it('reports missing, external, computed and escaping references without closure', () => {
    const result = inspect([scope(), record('main.ts', [
      "import './missing.js';", "import 'node:fs';", "import 'typescript';",
      "import '../outside.js';", "import './extensionless';", "const value = import(name);",
    ].join('\n'))]);
    assert.equal(result.status, 'inspected');
    assert.equal(result.closed, false);
    assert.deepEqual(result.unresolved.map((issue: Issue) => issue.code), [
      'missing_reference', 'external_reference', 'external_reference', 'outside_inventory', 'unsupported_extension', 'computed_reference',
    ]);
  });

  it('distinguishes shadowed require from an unbound spelling without inventing CommonJS', () => {
    const result = inspect([scope(), record('main.ts', "require('./a.js'); function f(require: Function) { require('./a.js'); }")]);
    assert.equal(result.closed, false);
    assert.deepEqual(result.unresolved.map((issue: Issue) => issue.code), ['unbound_require', 'shadowed_require']);
    assert.deepEqual(result.edges, []);
  });

  it('requires actual package scopes, rejects duplicate JSON keys and leaves CJS unavailable', () => {
    assert.equal(inspectNodeNextModuleGraph([]).status, 'unavailable');
    assert.equal(inspect([record('main.ts', 'export {};')]).status, 'unavailable');
    assert.equal(inspect([scope(), record('sub/package.json', '{}'), record('sub/main.ts', 'export {};')]).status, 'unavailable');
    assert.equal(inspect([record('package.json', '{"type":"commonjs"}'), record('main.ts', 'export {};')]).status, 'unavailable');
    for (const extension of ['cts', 'cjs']) assert.equal(inspect([record(`main.${extension}`, 'export {};')]).status, 'unavailable');
    assert.equal(inspect([record('main.mts', 'export {};')]).closed, true);
    const broken = inspect([record('package.json', '{"type":"module","type":"module"}'), record('main.ts', 'export {};')]);
    assert.equal(broken.status, 'rejected');
    assert.deepEqual(broken.edges, []);
    assert.equal(inspect([scope(), record('main.ts', 'const broken = (')]).status, 'rejected');
  });

  it('does not choose ambiguous extension substitutions and terminates cyclic aliases', () => {
    const ambiguous = inspect([scope(), record('main.ts', "import './value.js';"), record('value.ts', 'export {};'), record('value.js', 'export {};')]);
    assert.equal(ambiguous.closed, false);
    assert.ok(ambiguous.unresolved.some((issue: Issue) => issue.code === 'ambiguous_reference'));
    const cycle = inspect([scope(), record('a.ts', "export { value } from './b.js';"), record('b.ts', "export { value } from './a.js';")]);
    assert.equal(cycle.status, 'inspected');
    assert.equal(cycle.closed, false);
    assert.ok(cycle.unresolved.some((issue: Issue) => issue.code === 'unresolved_binding'));
  });

  it('keeps unsupported module syntax and reference directives unresolved and bounds source count', () => {
    const result = inspect([scope(), record('main.ts', [
      '/// <reference path="./missing.ts" />',
      'type T = import("./missing.js").T;',
    ].join('\n'))]);
    assert.equal(result.status, 'inspected');
    assert.equal(result.closed, false);
    assert.ok(result.unresolved.some((issue: Issue) => issue.code === 'reference_directive_unavailable'));
    assert.ok(result.unresolved.some((issue: Issue) => issue.code === 'unsupported_module_syntax'));
    const excess = inspect(Array.from({ length: 129 }, (_, index) => record(`${index}.mts`, 'export {};')));
    assert.equal(excess.status, 'rejected');
    assert.equal(excess.unresolved[0].code, 'resource_limit');
    assert.deepEqual(excess.edges, []);
  });

  it('keeps mutable compiler contexts local and graph results detached across inspections', () => {
    const inputs = [scope(), record('main.ts', 'export const value = 1;')];
    const context = createNodeNextProgramContext(inputs, 'nodenext-explicit-v1');
    assert.equal(context.status, 'available');
    assert.ok(Object.isFrozen(context));
    assert.ok(Object.isFrozen(context.inventory.identities));
    const expected = inspect(inputs);
    assert.equal(expected.closed, true);
    const source = context.program.getSourceFile(context.inventory.rootNames[0]);
    source.text = 'mutated compiler object';
    inputs[1]!.bytes.fill(0);
    assert.equal(context.inventory.host.readFile('main.ts'), 'export const value = 1;');
    const repeated = inspect([scope(), record('main.ts', 'export const value = 1;')]);
    assert.deepEqual(repeated, expected);
    assert.equal(Object.hasOwn(repeated, 'program'), false);
    assert.equal(Object.hasOwn(repeated, 'inventory'), false);
    assert.equal(createNodeNextProgramContext([], 'bundler').code, 'policy_unavailable');
  });

  it('constructs the real Program/checker without ambient filesystem fallbacks', () => {
    const read = ts.sys.readFile, exists = ts.sys.fileExists;
    const trap = () => { throw new Error('ambient read'); };
    ts.sys.readFile = trap; ts.sys.fileExists = trap;
    try {
      const result = inspect([scope(), record('a.ts', "import { x } from './b.js';"), record('b.ts', 'export const x = 1;')]);
      assert.equal(result.status, 'inspected');
      assert.equal(result.closed, true);
    } finally { ts.sys.readFile = read; ts.sys.fileExists = exists; }
  });
});
