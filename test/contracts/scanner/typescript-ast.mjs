import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';
import { encodePathsBin } from '../outward-scanner.mjs';

export const AST_LIMITS = Object.freeze({ bytes: 1_048_576, nodes: 100_000, sites: 10_000 });
const scriptKinds = new Map([
  ['.ts', ts.ScriptKind.TS], ['.tsx', ts.ScriptKind.TSX],
  ['.js', ts.ScriptKind.JS], ['.jsx', ts.ScriptKind.JSX],
  ['.mts', ts.ScriptKind.TS], ['.cts', ts.ScriptKind.TS],
  ['.mjs', ts.ScriptKind.JS], ['.cjs', ts.ScriptKind.JS],
]);
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const failure = (code, diagnostics = []) => ({
  schema: 'wp00-typescript-syntax/v1', status: 'rejected', evaluation: 'syntax_only',
  flow: 'not_evaluated', admission: 'not_evaluated', sites: [],
  diagnostics: diagnostics.length ? diagnostics : [{ code, startOffset: null, endOffset: null, startLine: null, endLine: null }],
});

function span(source, start, end) {
  return { startOffset: start, endOffset: end,
    startLine: source.getLineAndCharacterOfPosition(start).line + 1,
    endLine: source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1 };
}

function reference(node) {
  if (ts.isImportDeclaration(node)) return ['import', node.moduleSpecifier, node.importClause?.isTypeOnly ?? false];
  if (ts.isExportDeclaration(node) && node.moduleSpecifier) return ['reexport', node.moduleSpecifier, node.isTypeOnly];
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return ['import_equals', node.moduleReference.expression, node.isTypeOnly];
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return ['dynamic_import', node.arguments[0], false];
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return ['require', node.arguments[0], false];
  }
  return null;
}

// Syntax inspection only: literal module text is not a resolved dependency,
// and a spelled `require` is not proof of the CommonJS binding. This component
// creates no sink ownership, suppression, RootResult, or admission authority.
// No Program/default host, filesystem lookup, emit, or scanned code execution.
// Limits reject whole inputs; they are not a hard CPU/memory isolation boundary.
export function inspectTypeScriptSyntax(observedRecord) {
  let record;
  try {
    if (!observedRecord || !(observedRecord.bytes instanceof Uint8Array)) return failure('invalid_input');
    const { path, mode, length, sha256, targetPath } = observedRecord;
    if (![0o100644, 0o100755].includes(mode) || targetPath !== undefined ||
      typeof length !== 'bigint' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return failure('invalid_input');
    if (observedRecord.bytes.byteLength > AST_LIMITS.bytes) return failure('resource_limit');
    const bytes = Buffer.from(observedRecord.bytes);
    record = { path, mode, length, sha256 };
    encodePathsBin([{ ...record, sha256: Buffer.from(sha256, 'hex') }]);
    if (length !== BigInt(bytes.length) || createHash('sha256').update(bytes).digest('hex') !== sha256) return failure('identity_mismatch');
    const kind = scriptKinds.get(posix.extname(path));
    if (kind === undefined) return failure('unsupported_extension');
    if (ts.version !== '5.9.3') return failure('parser_unavailable');
    let text;
    try { text = decoder.decode(bytes); } catch { return failure('invalid_utf8'); }
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
    if (!Array.isArray(source.parseDiagnostics)) return failure('parser_unavailable');
    if (source.parseDiagnostics.length) {
      const diagnostics = source.parseDiagnostics.slice(0, 32).map((diagnostic) => ({
        code: 'parse_error', ...span(source, diagnostic.start ?? 0,
          Math.min(text.length, (diagnostic.start ?? 0) + (diagnostic.length ?? 0))),
      }));
      // Diagnostic detail is bounded explicitly; no source-bearing messages.
      if (source.parseDiagnostics.length > 32) diagnostics.push({ code: 'diagnostic_limit',
        startOffset: null, endOffset: null, startLine: null, endLine: null });
      return failure('parse_error', diagnostics);
    }
    const pending = [source], sites = [];
    let visited = 0;
    while (pending.length) {
      const node = pending.pop();
      if (++visited > AST_LIMITS.nodes) return failure('resource_limit');
      const found = reference(node);
      if (found) {
        if (sites.length === AST_LIMITS.sites) return failure('resource_limit');
        const [kind, argument, typeOnly] = found;
        const literal = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
        sites.push({ kind, ...span(source, node.getStart(source), node.getEnd()),
          moduleSpecifier: literal ? argument.text : null,
          reference: literal ? 'literal' : 'computed_or_missing', typeOnly,
          arity: ts.isCallExpression(node) ? node.arguments.length : null,
          binding: 'not_evaluated' });
      }
      ts.forEachChild(node, (child) => { pending.push(child); });
    }
    sites.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    return { schema: 'wp00-typescript-syntax/v1', status: 'inspected', evaluation: 'syntax_only',
      flow: 'not_evaluated', admission: 'not_evaluated', parser: 'typescript@5.9.3',
      identity: record, sites, diagnostics: [] };
  } catch {
    return failure('parser_failure');
  }
}
