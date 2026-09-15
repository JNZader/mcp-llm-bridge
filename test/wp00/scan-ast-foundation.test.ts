import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { AST_LIMITS, inspectTypeScriptSyntax } from '../contracts/scanner/typescript-ast.mjs';

function fixture(text: string | Buffer, path = 'src/input.ts') {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return { path, mode: 0o100644, length: BigInt(bytes.length),
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
interface Site {
  kind: string; moduleSpecifier: string | null; reference: string; binding: string;
  startOffset: number; endOffset: number; startLine: number; endLine: number;
  arity: number | null; typeOnly: boolean;
}
function reject(record: unknown, code?: string) {
  const result = inspectTypeScriptSyntax(record);
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.sites, []);
  if (code) assert.equal(result.diagnostics[0].code, code);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
}

describe('TypeScript AST syntax foundation, not admission', () => {
  it('uses real syntax parsing for all eight extensions without changing admission', () => {
    for (const extension of ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']) {
      const jsx = ['tsx', 'jsx'].includes(extension) ? 'const view = <div />;' : '';
      const record = fixture(`import value from './dep.js'; ${jsx}`, `src/input.${extension}`);
      const result = inspectTypeScriptSyntax(record);
      assert.equal(result.status, 'inspected', extension);
      assert.equal(result.evaluation, 'syntax_only');
      assert.equal(result.flow, 'not_evaluated');
      assert.equal(result.admission, 'not_evaluated');
      assert.equal(result.parser, 'typescript@5.9.3');
      assert.deepEqual(result.identity, { path: record.path, mode: record.mode, length: record.length, sha256: record.sha256 });
      assert.equal(result.sites[0].moduleSpecifier, './dep.js');
      assert.deepEqual(inspectTypeScriptSyntax(record), result);
      reject(fixture('import { secret-canary', `src/broken.${extension}`), 'parse_error');
    }
  });

  it('extracts structural module sites but never claims their binding or resolution', () => {
    const text = [
      "import type { T } from './types';", "export * from './barrel';",
      "import lib = require('./legacy');", "const a = require('./direct');",
      "async function nested(require: Function) { return require(name) + await import(`./${name}`); }",
      "const b = import('./lazy', { with: { type: 'json' } });",
      "const c = require(); const d = require(`./literal`);",
      "// require('comment')", 'const ignored = "import(\'string\')";',
      "object.require('method'); const alias = require;",
    ].join('\n');
    const result = inspectTypeScriptSyntax(fixture(text));
    assert.equal(result.status, 'inspected');
    assert.deepEqual(result.sites.map((site: Site) => [site.kind, site.moduleSpecifier]), [
      ['import', './types'], ['reexport', './barrel'], ['import_equals', './legacy'],
      ['require', './direct'], ['require', null], ['dynamic_import', null],
      ['dynamic_import', './lazy'], ['require', null], ['require', './literal'],
    ]);
    assert.equal(result.sites[0].typeOnly, true);
    assert.equal(result.sites[6].arity, 2);
    for (const site of result.sites as Site[]) assert.equal(site.binding, 'not_evaluated');
    assert.equal(result.sites[4].reference, 'computed_or_missing');
  });

  it('preserves exact UTF-16 offsets, BOM and CRLF line ranges', () => {
    const prefix = '\ufeffconst emoji = "😀";\r\n';
    const expression = "import(\r\n  './lazy'\r\n)";
    const result = inspectTypeScriptSyntax(fixture(prefix + expression + ';'));
    assert.equal(result.status, 'inspected');
    const site = result.sites[0] as Site;
    assert.equal(site.startOffset, prefix.length);
    assert.equal(site.endOffset, prefix.length + expression.length);
    assert.equal(site.startLine, 2);
    assert.equal(site.endLine, 4);
    assert.equal((prefix + expression).slice(site.startOffset, site.endOffset), expression);
  });

  it('rejects malformed input without exposing recovered sites or source diagnostics', () => {
    reject(fixture("import './good'; const secret-canary = ("), 'parse_error');
    reject(fixture(Buffer.from([0xff])), 'invalid_utf8');
    reject(fixture('const x = 1;', 'file.json'), 'unsupported_extension');
    const good = fixture('const x = 1;');
    reject({ ...good, sha256: '0'.repeat(64) }, 'identity_mismatch');
    reject({ ...good, length: good.length + 1n }, 'identity_mismatch');
    reject({ ...good, length: 12 }, 'invalid_input');
    reject({ ...good, mode: 0o120000 }, 'invalid_input');
    reject({ ...good, mode: 0o100600 }, 'invalid_input');
    reject({ ...good, targetPath: 'other.ts' }, 'invalid_input');
    reject({ ...good, path: '../escape.ts' });
    reject(null, 'invalid_input');
    assert.equal(inspectTypeScriptSyntax({ ...good, mode: 0o100755 }).status, 'inspected');
  });

  it('fails whole inputs at explicit resource limits, without truncating sites', () => {
    reject(fixture(' '.repeat(AST_LIMITS.bytes + 1)), 'resource_limit');
    reject(fixture("require('x');\n".repeat(AST_LIMITS.sites + 1)), 'resource_limit');
    reject(fixture('x;\n'.repeat(AST_LIMITS.nodes)), 'resource_limit');
  });

  it('inspects real tracked TS, TSX and JS representatives without executing them', () => {
    for (const path of ['src/core/config.ts', 'dashboard/src/components/CostChart.tsx', 'test-pageindex-simple.js']) {
      const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
      const result = inspectTypeScriptSyntax(fixture(bytes, path));
      assert.equal(result.status, 'inspected', path);
      assert.equal(result.admission, 'not_evaluated');
      assert.ok(result.sites.length > 0, path);
    }
  });
});
