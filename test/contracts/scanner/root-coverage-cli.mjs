import { canonicalizeJcs } from '../outward-scanner.mjs';
import { collectRootInventory } from './root-inventory.mjs';
import { classifyExecutionRoots } from './root-integration.mjs';

const schema = 'wp00-root-coverage/v1';
const failure = (code) => ({ schema, status: 'coverage_failed', admission: 'not_evaluated',
  diagnostics: [{ code, line: null, column: null, field: null }] });
const count = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
};

// Usage: node test/contracts/outward-scanner.mjs coverage --cwd <worktree-root>
// Exit 0 means the classification report was produced, NOT security approval.
// Exit 1 means inventory/classification failed; exit 2 means invalid arguments.
// No grammar parser, image resolver, provider admission or native review runs.
export function runCoverageCli(args, write = (text) => process.stdout.write(text)) {
  if (!Array.isArray(args) || args.length !== 3 || args[0] !== 'coverage' || args[1] !== '--cwd' ||
    typeof args[2] !== 'string' || !args[2] || args[2].includes('\0')) {
    write(canonicalizeJcs(failure('invalid_arguments')) + '\n');
    return 2;
  }
  let report;
  try {
    const inventory = collectRootInventory(args[2]);
    const classified = classifyExecutionRoots(inventory.records);
    if (classified.status !== 'classified') throw new Error();
    const descriptors = classified.roots.map(({ path, mode, sha256, format, disposition, execution, generated, obligations }) =>
      ({ path, mode, sha256, format, disposition, execution, generated, obligations }));
    report = { schema, status: 'coverage_only', admission: 'not_evaluated', evaluation: 'classification_only',
      exitZeroMeaning: 'report_produced_not_security_approval',
      totals: { total: classified.coverage.observed, passive: classified.coverage.passive, execution: classified.coverage.execution },
      byFormat: count(descriptors.map((root) => root.format)), byDisposition: count(descriptors.map((root) => root.disposition)),
      byObligation: count(descriptors.flatMap((root) => root.obligations)), descriptors, diagnostics: [] };
  } catch {
    write(canonicalizeJcs(failure('inventory_or_classification_failed')) + '\n');
    return 1;
  }
  write(canonicalizeJcs(report) + '\n');
  return 0;
}
