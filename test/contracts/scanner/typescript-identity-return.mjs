import ts from 'typescript';
import { VIRTUAL_ROOT } from './typescript-modules.mjs';

function span(node) {
  const source = node.getSourceFile();
  return Object.freeze({ path: source.fileName.slice(VIRTUAL_ROOT.length + 1),
    startOffset: node.getStart(source), endOffset: node.getEnd() });
}

function result(status, fact = null, code) {
  return Object.freeze({ status, semantics: 'declared_callable_normal_return',
    runtimeBinding: 'not_evaluated', fact: fact && Object.freeze(fact),
    diagnostics: Object.freeze(code ? [Object.freeze({ code })] : []) });
}

// Conditional summary of this declaration's body, NOT proof that a call invokes it.
// No source execution, type coercion, interprocedural flow, or safety inference.
export function createIdentityReturnInspector(checker, maxWork = 50_000) {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) throw new Error('invalid_budget');
  const cache = new Map();
  let remaining = maxWork;
  function spend() {
    if (--remaining < 0) throw new Error('resource_limit');
  }
  function inspect(declaration) {
    const fn = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
    if (!fn || !ts.isFunctionLike(fn) || !fn.body) return result('unsupported', null, 'unsupported_callable');
    for (const node of [fn, declaration, ts.isClassDeclaration(declaration.parent) ? declaration.parent : undefined]) {
      if (!node) continue;
      for (const modifier of node.modifiers ?? []) {
        spend();
        if (![ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword, ts.SyntaxKind.StaticKeyword].includes(modifier.kind)) {
          return result('unsupported', null, 'unsupported_modifier');
        }
      }
    }
    if (fn.asteriskToken) return result('unsupported', null, 'generator');
    const parameters = new Map(), names = new Set();
    for (let index = 0; index < fn.parameters.length; index++) {
      spend();
      const parameter = fn.parameters[index];
      if (!ts.isIdentifier(parameter.name) || parameter.name.text === 'this' || parameter.initializer ||
        parameter.questionToken || parameter.dotDotDotToken || parameter.modifiers?.length || names.has(parameter.name.text)) {
        return result('unsupported', null, 'unsupported_parameter');
      }
      names.add(parameter.name.text);
      const symbol = checker.getSymbolAtLocation(parameter.name);
      if (!symbol || parameters.has(symbol)) return result('unsupported', null, 'unresolved_parameter');
      parameters.set(symbol, index);
    }
    let expression = fn.body, returnNode = fn.body;
    if (ts.isBlock(fn.body)) {
      if (fn.body.statements.length !== 1 || !ts.isReturnStatement(fn.body.statements[0])) {
        return result('unsupported', null, 'non_identity_body');
      }
      returnNode = fn.body.statements[0];
      expression = returnNode.expression;
    }
    while (expression && ts.isParenthesizedExpression(expression)) {
      spend();
      expression = expression.expression;
    }
    spend();
    if (!expression || !ts.isIdentifier(expression)) return result('unsupported', null, 'non_parameter_return');
    const parameterIndex = parameters.get(checker.getSymbolAtLocation(expression));
    if (parameterIndex === undefined) return result('unsupported', null, 'non_parameter_return');
    return result('transfer_proven', { relation: 'return_equals_entry_parameter', parameterIndex,
      declarationSpan: span(declaration), returnSpan: span(returnNode) });
  }
  return (declaration) => {
    try {
      spend(); // Cache hits still consume aggregate materialization capacity.
      if (!cache.has(declaration)) cache.set(declaration, inspect(declaration));
      return cache.get(declaration);
    } catch (error) {
      return result('unavailable', null, error?.message === 'resource_limit' ? 'resource_limit' : 'inspection_unavailable');
    }
  };
}
