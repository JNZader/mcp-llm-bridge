import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { tokenizeShell } from '../contracts/scanner/posix-shell.mjs';

interface Part { kind: string; value?: string; quote?: string; raw?: string; syntax?: string; stream?: Stream; start: number; end: number }
interface Token { kind: string; value?: string; parts?: Part[]; stream?: Stream; start: number; end: number }
interface Stream { source: string; tokens: Token[] }
const words = (stream: Stream) => stream.tokens.filter((token) => token.kind === 'word');
const text = (token: Token) => token.parts?.map((part) => part.value ?? part.raw ?? '').join('');
const reject = (source: string, code: string) => assert.throws(() => tokenizeShell(source), { message: `WP00 shell lexer: ${code}` });

describe('SCAN-ROOT-SHELL lexical component', () => {
  it('preserves assignment words, operators, groups and exact source spans without claiming admission', () => {
    const source = 'MODE=fast tool a | other && (left; right) || fallback\n';
    const result = tokenizeShell(source);
    assert.equal(result.status, 'lexed');
    assert.equal(Object.hasOwn(result, 'edges'), false);
    assert.deepEqual(result.tokens.filter((token: Token) => token.kind === 'operator').map((token: Token) => token.value), ['|', '&&', '||', '\n']);
    assert.deepEqual(words(result).map(text), ['MODE=fast', 'tool', 'a', 'other', 'fallback']);
    for (const token of words(result)) assert.equal(source.slice(token.start, token.end), text(token));
    const group = result.tokens.find((token: Token) => token.kind === 'group');
    assert.equal(source.slice(group.start, group.end), '(left; right)');
    assert.deepEqual(words(group.stream).map(text), ['left', 'right']);
    assert.deepEqual(tokenizeShell(source), result);
  });
  it('retains quote provenance, adjacent word fragments, escaped metacharacters and line continuation', () => {
    const result = tokenizeShell("cmd pre' a 'post \"$HOME\" a\\ b \\\nnext '' \"\\q\" '#literal' # ignored\n");
    assert.deepEqual(words(result).map(text), ['cmd', 'pre a post', '$HOME', 'a b', 'next', '', '\\q', '#literal']);
    const parameter = words(result)[2]?.parts?.find((part) => part.kind === 'parameter');
    assert.equal(parameter?.quote, 'double');
    assert.equal(words(result)[3]?.parts?.some((part) => part.quote === 'escaped'), true);
    assert.equal(words(result)[5]?.parts?.[0]?.quote, 'single');
  });
  it('captures recursively nested dollar substitutions and independent backtick source streams', () => {
    const result = tokenizeShell('echo "$(printf %s "$(pwd)")" `printf %s \\`pwd\\``');
    const dollar = words(result)[1]?.parts?.find((part) => part.kind === 'substitution');
    assert.equal(dollar?.syntax, 'dollar');
    assert.deepEqual(words(dollar!.stream!).slice(0, 2).map(text), ['printf', '%s']);
    const nested = words(dollar!.stream!)[2]?.parts?.find((part) => part.kind === 'substitution');
    assert.deepEqual(words(nested!.stream!).map(text), ['pwd']);
    const backtick = words(result)[2]?.parts?.[0];
    assert.equal(backtick?.syntax, 'backtick');
    assert.equal(backtick?.stream?.source, 'printf %s `pwd`');
    assert.equal(words(backtick!.stream!)[2]?.parts?.[0]?.syntax, 'backtick');
  });
  it('retains indirect parameters and unsupported operators as evidence for the semantic validator', () => {
    const result = tokenizeShell('eval ${!name} > output &');
    assert.deepEqual(words(result).map(text), ['eval', '${!name}', 'output']);
    assert.deepEqual(result.tokens.filter((token: Token) => token.kind === 'operator').map((token: Token) => token.value), ['>', '&']);
    assert.equal(tokenizeShell('echo &&').status, 'lexed'); // Invalid grammar remains B responsibility.
  });
  it('rejects malformed lexical boundaries with stable content-free diagnostics', () => {
    for (const source of ["echo 'secret-canary", 'echo "secret-canary']) reject(source, 'unterminated_quote');
    reject('echo `secret-canary', 'unterminated_backtick');
    reject('echo ${secret-canary', 'unterminated_parameter');
    reject('echo \\', 'invalid_escape');
    for (const source of ['(echo secret-canary', 'echo $(secret-canary', ')']) reject(source, 'unbalanced_group');
    reject('echo $((1+2))', 'unsupported_arithmetic');
    reject('secret-canary\0', 'invalid_input');
  });
  it('bounds source size, nesting and token work without executing any scanned commands', () => {
    reject('a'.repeat(65_537), 'limit_exceeded');
    reject('('.repeat(34) + 'echo' + ')'.repeat(34), 'limit_exceeded');
    reject('$('.repeat(34) + 'pwd' + ')'.repeat(34), 'limit_exceeded');
    reject('x;'.repeat(5_000), 'limit_exceeded');
    assert.equal(tokenizeShell('rm -rf /never-executed').status, 'lexed');
    assert.deepEqual(tokenizeShell('').tokens, []);
  });
});
