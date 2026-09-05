import ts from 'typescript';
import { VIRTUAL_ROOT } from './typescript-modules.mjs';
import { createNodeNextProgramContext, NODE_NEXT_SOURCE_LIMIT } from './typescript-program.mjs';

export const GRAPH_LIMITS = Object.freeze({ sources: NODE_NEXT_SOURCE_LIMIT, nodes: 200_000, records: 20_000 });
const relative = (path) => path.slice(VIRTUAL_ROOT.length + 1);
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
const failure = (code, status = 'rejected') => freeze({ schema: 'wp00-typescript-graph/v1', status,
  closed: false, admission: 'not_evaluated', flow: 'not_evaluated', edges: [], bindings: [], unresolved: [{ code }] });
function location(node) {
  const source = node.getSourceFile(), start = node.getStart(source), end = node.getEnd();
  return { path: relative(source.fileName), startOffset: start, endOffset: end,
    startLine: source.getLineAndCharacterOfPosition(start).line + 1,
    endLine: source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1 };
}

// Bounded NodeNext ESM source graph, not runtime resolution or typecheck PASS.
// Explicit package scope is mandatory; no Bundler, package exports, directory
// imports, ambient libraries, or CommonJS inference. Ambiguous substitution
// candidates remain unresolved rather than choosing a potentially wrong file.
export function inspectNodeNextModuleGraph(records, policy) {
  const context = createNodeNextProgramContext(records, policy);
  if (context.status !== 'available') return failure(context.code, context.status);
  const { inventory, program, resolve, hasSource } = context;
  try {
    const checker = program.getTypeChecker(), edges = [], bindings = [], unresolved = [];
    let visited = 0;
    const pending = inventory.rootNames.map((name) => program.getSourceFile(name));
    while (pending.length) {
      const node = pending.pop();
      if (!node) return failure('missing_source');
      if (++visited > GRAPH_LIMITS.nodes || edges.length + bindings.length + unresolved.length > GRAPH_LIMITS.records) return failure('resource_limit');
      if (ts.isSourceFile(node) && (node.referencedFiles.length || node.typeReferenceDirectives.length || node.libReferenceDirectives.length)) {
        unresolved.push({ ...location(node), code: 'reference_directive_unavailable' });
      }
      let kind, argument;
      if (ts.isImportDeclaration(node)) { kind = 'import'; argument = node.moduleSpecifier; }
      else if (ts.isExportDeclaration(node) && node.moduleSpecifier) { kind = 'reexport'; argument = node.moduleSpecifier; }
      else if (ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node)) unresolved.push({ ...location(node), code: 'unsupported_module_syntax' });
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) { kind = 'dynamic_import'; argument = node.arguments[0]; }
      else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const symbol = checker.getSymbolAtLocation(node.expression);
        unresolved.push({ ...location(node), code: symbol?.declarations?.length ? 'shadowed_require' : 'unbound_require' });
      }
      if (kind) {
        const literal = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
        const target = resolve(literal ? argument.text : undefined, node.getSourceFile().fileName);
        const edge = { ...location(node), kind, target: target.code ? null : relative(target.resolvedFileName) };
        edges.push(edge);
        if (target.code) unresolved.push({ ...location(node), code: target.code });
      }
      const aliasNode = ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isExportSpecifier(node) ? node.name :
        ts.isImportClause(node) ? node.name : undefined;
      if (aliasNode) {
        const symbol = checker.getSymbolAtLocation(aliasNode);
        const origin = symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
        const declarations = origin?.declarations ?? [];
        if (!declarations.length || declarations.some((declaration) => !hasSource(declaration.getSourceFile().fileName))) {
          unresolved.push({ ...location(aliasNode), code: 'unresolved_binding' });
        } else {
          bindings.push({ ...location(aliasNode), localName: aliasNode.text,
            origins: declarations.map(location), evidence: 'typescript_checker_alias' });
        }
      }
      ts.forEachChild(node, (child) => { pending.push(child); });
    }
    if (edges.length + bindings.length + unresolved.length > GRAPH_LIMITS.records) return failure('resource_limit');
    const order = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)) || a.startOffset - b.startOffset;
    edges.sort(order); bindings.sort(order); unresolved.sort(order);
    return freeze({ schema: 'wp00-typescript-graph/v1', status: 'inspected', closed: unresolved.length === 0,
      evaluation: 'bounded_esm_module_graph', admission: 'not_evaluated', flow: 'not_evaluated',
      semanticTypecheck: 'not_evaluated', identities: inventory.identities, edges, bindings, unresolved });
  } catch {
    return failure('invalid_graph');
  }
}
