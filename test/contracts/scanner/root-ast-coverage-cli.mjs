import { canonicalizeJcs } from '../outward-scanner.mjs';
import { collectRootInventory } from './root-inventory.mjs';
import { classifyExecutionRoots } from './root-integration.mjs';
import { AST_LIMITS, inspectTypeScriptSyntax } from './typescript-ast.mjs';

const schema = 'wp00-ast-coverage/v1';
const failure = (code) => ({ schema, status: 'coverage_failed', admission: 'not_evaluated',
  graph: 'not_evaluated', flow: 'not_evaluated', diagnostics: [{ code }] });
function count(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
}

// Usage: node test/contracts/outward-scanner.mjs ast-coverage --cwd <root>
// Reports each inventory descriptor and each eligible file's syntax outcome.
// No graph partitioning, selector admission, resource-cap increases or generated
// exclusions. Successful syntax does not discharge the awaiting_ast obligation.
// Exit 0 = report produced (including rejected files); 1 = inventory failure;
// 2 = invalid arguments. Per-file limits are not hard process isolation bounds.
export function runAstCoverageCli(args, write = (text) => process.stdout.write(text)) {
  if (!Array.isArray(args) || args.length !== 3 || args[0] !== 'ast-coverage' || args[1] !== '--cwd' ||
    typeof args[2] !== 'string' || !args[2] || args[2].includes('\0')) {
    write(canonicalizeJcs(failure('invalid_arguments')) + '\n');
    return 2;
  }
  let report;
  try {
    const inventory = collectRootInventory(args[2]);
    const classified = classifyExecutionRoots(inventory.records);
    if (classified.status !== 'classified') throw new Error();
    const records = new Map(inventory.records.map((record) => [record.path, record]));
    const outcomes = [];
    const descriptors = classified.roots.map((root) => {
      const { path, mode, sha256, length, format, disposition, execution, generated, obligations } = root;
      let ast = null;
      if (format === 'typescript_javascript') {
        const result = inspectTypeScriptSyntax(records.get(path));
        ast = { status: result.status, referenceCount: result.sites.length,
          referencesByKind: count(result.sites.map((site) => site.kind)),
          diagnostics: result.diagnostics.map(({ code, startOffset, endOffset, startLine, endLine }) =>
            ({ code, startOffset, endOffset, startLine, endLine })) };
        outcomes.push(ast);
      }
      return { path, mode, sha256, lengthBytes: length.toString(), format, disposition,
        execution, generated, obligations, ast };
    });
    report = { schema, status: 'coverage_only', evaluation: 'per_file_syntax_only',
      admission: 'not_evaluated', graph: 'not_evaluated', flow: 'not_evaluated',
      exitZeroMeaning: 'report_produced_not_security_approval', parser: 'typescript@5.9.3', limits: AST_LIMITS,
      totals: { total: classified.coverage.observed, passive: classified.coverage.passive, execution: classified.coverage.execution,
        astAttempted: outcomes.length, astInspected: outcomes.filter((outcome) => outcome.status === 'inspected').length,
        astRejected: outcomes.filter((outcome) => outcome.status === 'rejected').length,
        astNotApplicable: descriptors.length - outcomes.length,
        syntaxReferences: outcomes.reduce((total, outcome) => total + outcome.referenceCount, 0) },
      byFormat: count(descriptors.map((root) => root.format)),
      byDisposition: count(descriptors.map((root) => root.disposition)),
      byObligation: count(descriptors.flatMap((root) => root.obligations)),
      byAstDiagnostic: count(outcomes.flatMap((outcome) => outcome.diagnostics.map((diagnostic) => diagnostic.code))),
      descriptors, diagnostics: [] };
  } catch {
    write(canonicalizeJcs(failure('inventory_or_classification_failed')) + '\n');
    return 1;
  }
  write(canonicalizeJcs(report) + '\n');
  return 0;
}
