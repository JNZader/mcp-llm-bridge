import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const cli = fileURLToPath(new URL('../contracts/outward-scanner.mjs', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 4_194_304 });
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
interface Descriptor {
  path: string; disposition: string; generated: boolean; obligations: string[];
  ast: AstOutcome | null;
}
interface AstOutcome { status: string; diagnostics: { code: string }[]; referenceCount: number }
function repository(check: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'wp00-ast-coverage-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    mkdirSync(join(root, 'docs/assets'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\nkeep.ts\n');
    writeFileSync(join(root, 'ignored.txt'), 'secret-canary');
    writeFileSync(join(root, 'keep.ts'), "import 'private-module-canary'; const value = 'secret-canary';");
    writeFileSync(join(root, 'view.tsx'), "const view = <div>secret-canary</div>;");
    writeFileSync(join(root, 'script.js'), "require('private-module-canary');");
    writeFileSync(join(root, 'broken.ts'), 'const secret = "secret-canary"; const x = (');
    writeFileSync(join(root, 'docs/assets/bundle.js'), '/*' + ' '.repeat(1_048_576) + '*/');
    writeFileSync(join(root, 'README.md'), 'passive secret-canary');
    execFileSync('git', ['add', '.gitignore', 'view.tsx', 'script.js', 'broken.ts', 'docs/assets/bundle.js', 'README.md'], { cwd: root });
    execFileSync('git', ['add', '--force', 'keep.ts'], { cwd: root });
    check(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('AST coverage CLI: complete inventory, independent syntax only', () => {
  it('reports every eligible file once including malformed and oversized generated roots', () => {
    repository((root) => {
      writeFileSync(join(root, 'untracked.ts'), 'export const value = 1;');
      const files = ['.git/index', '.gitignore', 'keep.ts', 'view.tsx', 'script.js', 'broken.ts', 'docs/assets/bundle.js', 'README.md', 'untracked.ts'];
      const before = files.map((path) => digest(join(root, path)));
      const first = run(['ast-coverage', '--cwd', root]);
      assert.equal(first.status, 0, first.stderr); assert.equal(first.stderr, '');
      assert.equal(first.stdout, run(['ast-coverage', '--cwd', root]).stdout);
      const report = JSON.parse(first.stdout);
      assert.equal(report.schema, 'wp00-ast-coverage/v1');
      assert.equal(report.status, 'coverage_only');
      assert.equal(report.evaluation, 'per_file_syntax_only');
      for (const field of ['graph', 'flow', 'admission']) assert.equal(report[field], 'not_evaluated');
      assert.equal(report.exitZeroMeaning, 'report_produced_not_security_approval');
      assert.deepEqual(report.totals, { total: 8, passive: 1, execution: 7,
        astAttempted: 6, astInspected: 4, astRejected: 2, astNotApplicable: 2, syntaxReferences: 2 });
      const descriptors = report.descriptors as Descriptor[];
      const paths = descriptors.map((item) => item.path);
      assert.equal(new Set(paths).size, 8);
      assert.deepEqual(paths, [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
      assert.equal(descriptors.filter((item) => item.ast !== null).length, 6);
      assert.equal(report.byDisposition.awaiting_ast, 6);
      const bundle = descriptors.find((item) => item.path === 'docs/assets/bundle.js')!;
      assert.equal(bundle.generated, true); assert.deepEqual(bundle.obligations, ['generated_provenance']);
      assert.equal(bundle.ast?.diagnostics[0]?.code, 'resource_limit');
      assert.equal(descriptors.find((item) => item.path === 'broken.ts')?.ast?.diagnostics[0]?.code, 'parse_error');
      assert.equal(descriptors.find((item) => item.path === 'README.md')?.ast, null);
      assert.doesNotMatch(first.stdout, /secret-canary|private-module-canary|ignored\.txt|moduleSpecifier/);
      const { limits, ...withoutLimits } = report;
      assert.deepEqual(limits, { bytes: 1_048_576, nodes: 100_000, sites: 10_000 });
      assert.doesNotMatch(JSON.stringify(withoutLimits), /"bytes"/);
      for (const descriptor of descriptors) {
        assert.deepEqual(Object.keys(descriptor).sort(),
          ['path', 'mode', 'sha256', 'lengthBytes', 'format', 'disposition', 'execution', 'generated', 'obligations', 'ast'].sort());
        if (descriptor.ast) assert.deepEqual(Object.keys(descriptor.ast).sort(),
          ['status', 'referenceCount', 'referencesByKind', 'diagnostics'].sort());
      }
      // A numeric resource budget is allowed; source payload fields are not.
      assert.deepEqual(files.map((path) => digest(join(root, path))), before);
    });
  });

  it('preserves symlink obligations without parsing link bytes as source', () => {
    repository((root) => {
      symlinkSync('keep.ts', join(root, 'alias.ts'));
      const result = run(['ast-coverage', '--cwd', root]);
      assert.equal(result.status, 0, result.stderr);
      const alias = JSON.parse(result.stdout).descriptors.find((item: Descriptor) => item.path === 'alias.ts');
      assert.equal(alias.disposition, 'awaiting_link'); assert.equal(alias.ast, null);
      assert.deepEqual(alias.obligations, ['symlink_resolution', 'target_dispatch']);
      assert.equal(Object.hasOwn(alias, 'target'), false);
    });
  });

  it('keeps library imports silent and free of Git calls', () => {
    for (const file of ['../contracts/outward-scanner.mjs', '../contracts/scanner/root-ast-coverage-cli.mjs']) {
      const expression = `await import(${JSON.stringify(new URL(file, import.meta.url).href)})`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', expression],
        { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: '' } });
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    }
  });

  it('returns argument and inventory failures without reflecting caller input', () => {
    for (const args of [['ast-coverage'], ['ast-coverage', '--cwd', 'secret-canary', '--extra'], ['ast-coverage', '--root', 'secret-canary']]) {
      const result = run(args);
      assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'invalid_arguments');
      assert.doesNotMatch(result.stdout + result.stderr, /secret-canary/);
    }
    assert.equal(run(['ast-coverage', '--cwd', '/missing-secret-canary']).status, 1);
    repository((root) => {
      assert.equal(run(['ast-coverage', '--cwd', join(root, 'docs')]).status, 1);
      execFileSync('mkfifo', [join(root, 'pipe')]);
      const result = run(['ast-coverage', '--cwd', root]);
      assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'coverage_failed');
    });
  });
});
