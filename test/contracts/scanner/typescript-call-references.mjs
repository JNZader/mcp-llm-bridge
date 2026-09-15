import ts from 'typescript';
import { VIRTUAL_ROOT } from './typescript-modules.mjs';

function span(node) {
  const source = node.getSourceFile();
  return { path: source.fileName.slice(VIRTUAL_ROOT.length + 1),
    startOffset: node.getStart(source), endOffset: node.getEnd() };
}

const transparentKinds = new Set([
  'Block', 'ReturnStatement', 'Identifier', 'ObjectLiteralExpression', 'PropertyAssignment',
  'ShorthandPropertyAssignment', 'ArrayLiteralExpression', 'PropertyAccessExpression',
  'ParenthesizedExpression', 'StringLiteral', 'NumericLiteral', 'TrueKeyword', 'FalseKeyword',
  'NullKeyword', 'NoSubstitutionTemplateLiteral', 'ExpressionStatement', 'EmptyStatement',
]);

function boundary(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return 'mutation';
  if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) return 'mutation';
  if (ts.isDeleteExpression(node)) return 'mutation';
  if (ts.isVariableDeclaration(node)) return 'local_alias';
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) return 'call_boundary';
  if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isIterationStatement(node, false) ||
    ts.isTryStatement(node) || ts.isThrowStatement(node) || ts.isConditionalExpression(node) ||
    ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return 'control_boundary';
  return transparentKinds.has(ts.SyntaxKind[node.kind]) ? null : 'unsupported_syntax';
}

// Internal, inspection-local cache. References describe syntax, never incoming values or taint.
// One aggregate budget covers body traversal AND repeated per-call evidence materialization.
export function createCallReferenceInspector(checker, maxNodes = 50_000) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0) throw new Error('invalid_budget');
  let remaining = maxNodes;
  const cache = new Map();
  function spend(amount = 1) {
    remaining -= amount;
    if (remaining < 0) throw new Error('resource_limit');
  }
  function analyze(declaration) {
    const fn = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
    const parameters = [], symbols = new Map(), returns = [], boundaries = [];
    let outputCost = 1;
    for (const parameter of fn.parameters) {
      spend();
      if (!ts.isIdentifier(parameter.name) || parameter.questionToken || parameter.initializer || parameter.dotDotDotToken) {
        boundaries.push({ code: 'unsupported_parameter', span: span(parameter) });
      } else {
        const symbol = checker.getSymbolAtLocation(parameter.name);
        if (!symbol) boundaries.push({ code: 'unresolved_parameter', span: span(parameter) });
        else symbols.set(symbol, parameters.length);
      }
      parameters.push(span(parameter));
    }
    const pending = [];
    function addReturn(expression, node) {
      const index = returns.length;
      returns.push({ span: span(node), expressionKind: expression ? ts.SyntaxKind[expression.kind] : 'Absent', parameterReferences: [] });
      outputCost++;
      if (expression) pending.push({ node: expression, returnIndex: index });
    }
    if (ts.isBlock(fn.body)) pending.push({ node: fn.body, returnIndex: null });
    else addReturn(fn.body, fn.body);
    while (pending.length) {
      spend();
      const { node, returnIndex } = pending.pop();
      if (ts.isFunctionLike(node)) {
        boundaries.push({ code: 'closure_boundary', span: span(node) });
        continue; // Its returns/references belong to a different lexical function.
      }
      const code = boundary(node);
      if (code) boundaries.push({ code, span: span(node) });
      if (ts.isReturnStatement(node)) { addReturn(node.expression, node); continue; }
      if (returnIndex !== null && ts.isIdentifier(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
        const parameterIndex = symbols.get(symbol);
        if (parameterIndex !== undefined) {
          returns[returnIndex].parameterReferences.push({ parameterIndex, span: span(node) });
          outputCost++;
        }
      }
      const children = [];
      ts.forEachChild(node, (child) => { children.push(child); });
      for (let i = children.length - 1; i >= 0; i--) pending.push({ node: children[i], returnIndex });
    }
    return { parameters, returns, boundaries, outputCost: outputCost + boundaries.length };
  }
  return (declaration, call) => {
    const base = { evaluation: 'lexical_parameter_return_references', valueOrigin: 'not_evaluated' };
    try {
      spend();
      if (!cache.has(declaration)) cache.set(declaration, analyze(declaration));
      const analysis = cache.get(declaration);
      spend(analysis.outputCost + analysis.parameters.length + call.arguments.length);
      const boundaries = [...analysis.boundaries];
      if (call.arguments.length !== analysis.parameters.length) boundaries.push({ code: 'argument_parameter_count', span: span(call) });
      // Unsupported parameter shapes have no reliable positional interpretation in this slice.
      const unsupported = boundaries.some((item) => ['unsupported_parameter', 'unresolved_parameter', 'argument_parameter_count'].includes(item.code));
      const parameterArguments = unsupported ? [] : analysis.parameters.map((parameterSpan, index) => ({
        parameterIndex: index, argumentIndex: index, parameterSpan, argumentSpan: span(call.arguments[index]),
      }));
      return { ...base, status: boundaries.length ? 'unresolved' : 'references_reported',
        parameterArguments, returns: analysis.returns, boundaries };
    } catch (error) {
      const code = error?.message === 'resource_limit' ? 'resource_limit' : 'inspection_unavailable';
      return { ...base, status: 'unresolved', parameterArguments: [], returns: [], boundaries: [{ code }] };
    }
  };
}
