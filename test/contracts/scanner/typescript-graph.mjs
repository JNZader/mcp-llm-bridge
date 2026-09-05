import { posix } from 'node:path';
import ts from 'typescript';
import { createInventoryCompilerHost, VIRTUAL_ROOT } from './typescript-modules.mjs';
import { parseStrictJson } from './package-json.mjs';

export const GRAPH_LIMITS = Object.freeze({ sources: 128, nodes: 200_000, records: 20_000 });
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
  const inventory = createInventoryCompilerHost(records, policy);
  if (inventory.status !== 'available') return failure(inventory.diagnostics[0].code, inventory.status);
  if (inventory.rootNames.length > GRAPH_LIMITS.sources) return failure('resource_limit');
  try {
    const base = inventory.host, packages = new Map();
    for (const item of inventory.identities) {
      if (posix.basename(item.path) !== 'package.json') continue;
      const value = parseStrictJson(Buffer.from(base.readFile(item.path)));
      if (!value || Array.isArray(value) || typeof value !== 'object') return failure('invalid_package_scope');
      packages.set(posix.dirname(`${VIRTUAL_ROOT}/${item.path}`), value.type);
    }
    for (const path of inventory.rootNames) {
      if (/\.(?:cts|cjs)$/.test(path)) return failure('commonjs_unavailable', 'unavailable');
      if (/\.(?:mts|mjs)$/.test(path)) continue;
      let directory = posix.dirname(path), type;
      while (directory === VIRTUAL_ROOT || directory.startsWith(`${VIRTUAL_ROOT}/`)) {
        if (packages.has(directory)) { type = packages.get(directory); break; }
        directory = posix.dirname(directory);
      }
      if (type !== 'module') return failure(type === 'commonjs' ? 'commonjs_unavailable' : 'package_scope_unavailable', 'unavailable');
    }
    const sourceNames = new Set(inventory.rootNames);
    const resolve = (specifier, containingFile) => {
      if (typeof specifier !== 'string') return { code: 'computed_reference' };
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return { code: 'external_reference' };
      if (/[\\\x00?#%]/.test(specifier)) return { code: 'unsupported_reference' };
      const path = posix.normalize(posix.join(posix.dirname(containingFile), specifier));
      if (!path.startsWith(`${VIRTUAL_ROOT}/`)) return { code: 'outside_inventory' };
      const extension = posix.extname(path);
      const substitutions = extension === '.js' ? ['.ts', '.tsx', '.d.ts', '.js', '.jsx'] :
        extension === '.mjs' ? ['.mts', '.d.mts', '.mjs'] : null;
      if (!substitutions) return { code: 'unsupported_extension' };
      const stem = path.slice(0, -extension.length);
      const candidates = substitutions.map((suffix) => stem + suffix).filter((name) => sourceNames.has(name));
      if (candidates.length !== 1) return { code: candidates.length ? 'ambiguous_reference' : 'missing_reference' };
      const resolvedFileName = candidates[0];
      const extensionKind = resolvedFileName.endsWith('.d.mts') ? ts.Extension.Dmts :
        resolvedFileName.endsWith('.d.ts') ? ts.Extension.Dts :
        ({ '.ts': ts.Extension.Ts, '.tsx': ts.Extension.Tsx, '.js': ts.Extension.Js,
          '.jsx': ts.Extension.Jsx, '.mts': ts.Extension.Mts, '.mjs': ts.Extension.Mjs })[posix.extname(resolvedFileName)];
      return { resolvedFileName, extension: extensionKind, isExternalLibraryImport: false };
    };
    const getSourceFile = (name) => base.getSourceFile(name,
      { languageVersion: ts.ScriptTarget.ESNext, impliedNodeFormat: ts.ModuleKind.ESNext });
    const host = { ...base, getSourceFile,
      getSourceFileByPath: (name) => getSourceFile(name),
      resolveModuleNameLiterals: (names, containingFile) => names.map((name) => {
        const result = resolve(name.text, containingFile);
        return { resolvedModule: result.code ? undefined : result };
      }) };
    const program = ts.createProgram({ rootNames: [...inventory.rootNames], host, options: {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext, noLib: true, types: [], noEmit: true,
      allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, skipLibCheck: true,
    } });
    if (program.getSyntacticDiagnostics().length || program.getOptionsDiagnostics().length) return failure('program_diagnostic');
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
        if (!declarations.length || declarations.some((declaration) => !sourceNames.has(declaration.getSourceFile().fileName))) {
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
