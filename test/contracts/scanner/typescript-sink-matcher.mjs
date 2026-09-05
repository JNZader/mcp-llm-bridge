import { createHash } from 'node:crypto';
import ts from 'typescript';
import { createNodeNextProgramContext } from './typescript-program.mjs';
import { VIRTUAL_ROOT } from './typescript-modules.mjs';
import { decodeHistoricalSinkCatalog } from './typescript-sink-catalog.mjs';

const LIMITS = Object.freeze({ selectors: 1024, nodes: 200_000, calls: 20_000 });
const callSignatures = new Set(['CONSOLE-CALL', 'H-CHTML', 'H-CJSON', 'H-CREDIRECT', 'H-CTEXT',
  'H-HELPER', 'MCP-HELPER', 'MCP-SET', 'OTEL-ATTR', 'OTEL-EX', 'PINO-CALL']);
const hash = (text) => createHash('sha256').update(text).digest('hex');
const normalized = (text) => text.replace(/\r\n?/g, '\n');
const relative = (name) => name.slice(VIRTUAL_ROOT.length + 1);
const fail = () => { throw new Error('invalid_selector'); };
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function keys(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(' ') !== names.split(' ').sort().join(' ')) fail();
}
function location(node) {
  const source = node.getSourceFile(), startOffset = node.getStart(source), endOffset = node.getEnd();
  return { path: relative(source.fileName), startOffset, endOffset,
    startLine: source.getLineAndCharacterOfPosition(startOffset).line + 1,
    endLine: source.getLineAndCharacterOfPosition(Math.max(startOffset, endOffset - 1)).line + 1 };
}
const declarationKey = (node) => {
  const point = location(node);
  return JSON.stringify([point.path, point.startOffset, point.endOffset]);
};
function callable(node) {
  if (ts.isFunctionDeclaration(node)) return !!node.body;
  if (ts.isVariableDeclaration(node)) return !!node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
    !!(node.parent.flags & ts.NodeFlags.Const);
  return ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && !!node.body && ts.isClassDeclaration(node.parent) &&
    !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}
function scope(node) {
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if (ts.isFunctionDeclaration(parent) && ts.isSourceFile(parent.parent) &&
      parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return parent.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : parent.name?.text;
    }
    return undefined; // Nested functions/callbacks are not the enclosing export.
  }
  return null;
}
function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && !expression.questionDotToken) {
    const left = calleeName(expression.expression);
    return left ? `${left}.${expression.name.text}` : null;
  }
  return null;
}
const rejected = (code, status = 'rejected') => freeze({ schema: 'wp00-direct-sinks/v1', status,
  admission: 'not_evaluated', flow: 'not_evaluated', matches: [], unclassified: [], diagnostics: [{ code }] });

// The callback is separately trusted configuration, never scanned source code.
// Hashes only bind its choices to current bytes; they do not create that trust.
// Matches establish direct checker bindings, not safe behavior/dispositions.
export function createDirectSinkMatcher({ ledgerBytes, fixtureCatalogBytes, selectCurrentDeclarations } = {}) {
  const catalog = decodeHistoricalSinkCatalog(ledgerBytes, fixtureCatalogBytes);
  const select = selectCurrentDeclarations;
  return Object.freeze({ inspect(records, policy) {
    if (catalog.status !== 'decoded') return rejected('invalid_catalog');
    if (typeof select !== 'function') return rejected('selector_unavailable', 'unavailable');
    const context = createNodeNextProgramContext(records, policy);
    if (context.status !== 'available') return rejected(context.code, context.status);
    try {
      const { inventory, program } = context;
      const projection = select(catalog, inventory.identities);
      keys(projection, 'schema selectors');
      if (projection.schema !== 'wp00-current-sink-selectors/v1' || !Array.isArray(projection.selectors) ||
        projection.selectors.length > LIMITS.selectors) fail();
      const identities = new Map(inventory.identities.map((item) => [item.path, item]));
      const declarations = new Map(), calls = [], pending = inventory.rootNames.map((name) => program.getSourceFile(name));
      let visited = 0;
      while (pending.length) {
        const node = pending.pop();
        if (!node || ++visited > LIMITS.nodes) return rejected('resource_limit');
        if (callable(node)) declarations.set(declarationKey(node), node);
        if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
          if (calls.length === LIMITS.calls) return rejected('resource_limit');
          calls.push(node);
        }
        ts.forEachChild(node, (child) => { pending.push(child); });
      }
      const selected = new Map(), seenFixtures = new Set();
      for (const selector of projection.selectors) {
        keys(selector, 'recordIndex fixtureId callsiteScope declaration');
        keys(selector.callsiteScope, 'path inputSha256 exportName');
        keys(selector.declaration, 'path inputSha256 startOffset endOffset astSha256');
        const { callsiteScope: site, declaration } = selector;
        const expected = catalog.expectations[selector.recordIndex];
        if (!Number.isSafeInteger(selector.recordIndex) || selector.recordIndex < 0 || !expected ||
          expected.fixtureId !== selector.fixtureId || seenFixtures.has(selector.fixtureId) ||
          !callSignatures.has(expected.sink.signatureId)) fail();
        seenFixtures.add(selector.fixtureId);
        for (const identity of [site, declaration]) {
          if (typeof identity.path !== 'string' || typeof identity.inputSha256 !== 'string' ||
            identities.get(identity.path)?.sha256 !== identity.inputSha256) fail();
        }
        if (site.exportName !== null && (typeof site.exportName !== 'string' || !site.exportName || site.exportName.length > 256)) fail();
        const source = program.getSourceFile(`${VIRTUAL_ROOT}/${site.path}`);
        if (!source) fail();
        if (site.exportName !== null) {
          const scopes = source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && !!statement.body &&
            statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
            (statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name?.text) === site.exportName);
          if (scopes.length !== 1) fail();
        }
        if (!Number.isSafeInteger(declaration.startOffset) || !Number.isSafeInteger(declaration.endOffset) ||
          declaration.startOffset < 0 || declaration.endOffset <= declaration.startOffset) fail();
        const key = JSON.stringify([declaration.path, declaration.startOffset, declaration.endOffset]);
        const node = declarations.get(key);
        if (!node || hash(normalized(node.getSourceFile().text.slice(declaration.startOffset, declaration.endOffset))) !== declaration.astSha256) fail();
        const selectionKey = JSON.stringify([site.path, site.exportName, key]);
        if (selected.has(selectionKey)) fail();
        selected.set(selectionKey, expected);
      }
      const checker = program.getTypeChecker(), matches = [], unclassified = [];
      calls.sort((left, right) => {
        const a = location(left), b = location(right);
        return Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)) || a.startOffset - b.startOffset;
      });
      for (const call of calls) {
        const point = location(call), exportName = scope(call);
        let reason = 'unselected_binding';
        const name = ts.isCallExpression(call) ? calleeName(call.expression) : null;
        if (!ts.isCallExpression(call) || !name || call.questionDotToken || exportName === undefined) reason = 'unsupported_call';
        else if (call.arguments.some(ts.isSpreadElement)) reason = 'spread_arity';
        else {
          const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression);
          const origin = symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
          const origins = origin?.declarations ?? [];
          if (origins.length === 1 && callable(origins[0])) {
            const expected = selected.get(JSON.stringify([point.path, exportName, declarationKey(origins[0])]));
            if (expected && call.arguments.length === expected.sink.arity) {
              matches.push({ recordIndex: expected.recordIndex, fixtureId: expected.fixtureId,
                metadata: 'historical_expectation', evidence: 'direct_checker_binding',
                sink: { path: point.path, startLine: point.startLine, endLine: point.endLine, module: point.path,
                  exportName, callee: name, arity: call.arguments.length, signatureId: expected.sink.signatureId,
                  ownerUnit: expected.sink.ownerUnit, disposition: expected.sink.disposition } });
              continue;
            }
            if (expected) reason = 'arity_mismatch';
          } else reason = 'unresolved_binding';
        }
        unclassified.push({ ...point, code: reason });
      }
      return freeze({ schema: 'wp00-direct-sinks/v1', status: 'inspected', admission: 'not_evaluated',
        flow: 'not_evaluated', coverage: 'direct_calls_only', matches, unclassified, diagnostics: [] });
    } catch {
      return rejected('invalid_selector');
    }
  } });
}
