// Lexical evidence only: `lexed` is NOT a parsed/admitted RootResult. Grammar,
// command resolution and dynamic-evaluation rejection belong to the next component.
// Every stream owns `source`; its token/part spans are half-open UTF-16 offsets in
// that source. Substitution streams own their source independently (backticks unescape).
const MAX_SOURCE = 65_536;
const MAX_DEPTH = 32;
const MAX_ITEMS = 8_192;
const operators = ['&&', '||', ';;', ';&', '|&', '<<', '>>', '<&', '>&', '<>', '>|'];

function failure(code) {
  const error = new Error(`WP00 shell lexer: ${code}`);
  error.code = code;
  throw error;
}

function scanSource(source, budget, depth) {
  if (depth > MAX_DEPTH) failure('limit_exceeded');
  let offset = 0;
  const charge = () => { if (--budget.items < 0) failure('limit_exceeded'); };
  const partsForWord = (nesting) => {
    const parts = [];
    const literal = (value, quote, start, end) => {
      const previous = parts.at(-1);
      if (previous?.kind === 'literal' && previous.quote === quote && previous.end === start) {
        previous.value += value;
        previous.end = end;
      } else {
        charge();
        parts.push({ kind: 'literal', value, quote, start, end });
      }
    };
    const expansion = (quote, nesting) => {
      const start = offset;
      if (source.startsWith('$((', offset)) failure('unsupported_arithmetic');
      if (source.startsWith('$(', offset)) {
        offset += 2;
        const tokens = sequence(')', nesting + 1);
        charge();
        parts.push({ kind: 'substitution', syntax: 'dollar', quote, start, end: offset, stream: { source, tokens } });
      } else if (source.startsWith('${', offset)) {
        offset += 2;
        let braces = 1;
        while (offset < source.length && braces > 0) {
          const char = source[offset++];
          if (char === '\\') {
            if (offset === source.length) failure('invalid_escape');
            offset += 1;
          } else if (char === '{') braces += 1;
          else if (char === '}') braces -= 1;
        }
        if (braces !== 0) failure('unterminated_parameter');
        charge();
        parts.push({ kind: 'parameter', quote, start, end: offset, raw: source.slice(start, offset) });
      } else if (source[offset] === '$') {
        const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!\-])/.exec(source.slice(offset));
        if (!match) { offset += 1; literal('$', quote, start, offset); return; }
        offset += match[0].length;
        charge();
        parts.push({ kind: 'parameter', quote, start, end: offset, raw: match[0] });
      } else {
        offset += 1;
        let nested = '';
        while (offset < source.length && source[offset] !== '`') {
          if (source[offset] === '\\' && ['$', '`', '\\', '\n'].includes(source[offset + 1])) {
            offset += 1;
            if (source[offset] === '\n') { offset += 1; continue; }
          }
          nested += source[offset++];
        }
        if (offset === source.length) failure('unterminated_backtick');
        offset += 1;
        charge();
        parts.push({ kind: 'substitution', syntax: 'backtick', quote, start, end: offset,
          stream: scanSource(nested, budget, nesting + 1) });
      }
    };
    const escaped = (quote) => {
      const start = offset++;
      if (offset === source.length) failure('invalid_escape');
      const value = source[offset++];
      if (value === '\n') return;
      if (quote === 'double' && !['$', '`', '"', '\\'].includes(value)) literal('\\' + value, quote, start, offset);
      else literal(value, 'escaped', start, offset);
    };
    while (offset < source.length && !/[ \t\n;&|()<>]/.test(source[offset])) {
      const start = offset;
      const char = source[offset];
      if (char === "'") {
        offset += 1;
        const content = offset;
        while (offset < source.length && source[offset] !== "'") offset += 1;
        if (offset === source.length) failure('unterminated_quote');
        literal(source.slice(content, offset), 'single', start, ++offset);
      } else if (char === '"') {
        offset += 1;
        literal('', 'double', start, offset);
        while (offset < source.length && source[offset] !== '"') {
          if (source[offset] === '\\') escaped('double');
          else if (source[offset] === '$' || source[offset] === '`') expansion('double', nesting);
          else { const index = offset++; literal(source[index], 'double', index, offset); }
        }
        if (offset === source.length) failure('unterminated_quote');
        offset += 1;
      } else if (char === '\\') escaped('unquoted');
      else if (char === '$' || char === '`') expansion('unquoted', nesting);
      else { offset += 1; literal(char, 'unquoted', start, offset); }
    }
    return parts;
  };
  const sequence = (closing, nesting) => {
    if (nesting > MAX_DEPTH) failure('limit_exceeded');
    const tokens = [];
    while (offset < source.length) {
      const start = offset;
      const char = source[offset];
      if (char === ' ' || char === '\t') { offset += 1; continue; }
      if (source.startsWith('\\\n', offset)) { offset += 2; continue; }
      if (char === '#') { while (offset < source.length && source[offset] !== '\n') offset += 1; continue; }
      if (char === ')') {
        if (!closing) failure('unbalanced_group');
        offset += 1;
        return tokens;
      }
      charge();
      if (char === '(') {
        offset += 1;
        const nested = sequence(')', nesting + 1);
        tokens.push({ kind: 'group', start, end: offset, stream: { source, tokens: nested } });
      } else if (/[\n;&|<>]/.test(char)) {
        const value = operators.find((operator) => source.startsWith(operator, offset)) ?? char;
        offset += value.length;
        tokens.push({ kind: 'operator', value, start, end: offset });
      } else {
        const parts = partsForWord(nesting);
        tokens.push({ kind: 'word', start, end: offset, parts });
      }
    }
    if (closing) failure('unbalanced_group');
    return tokens;
  };
  return { source, tokens: sequence(null, depth) };
}

export function tokenizeShell(source) {
  if (typeof source !== 'string' || source.includes('\0')) failure('invalid_input');
  if (source.length > MAX_SOURCE) failure('limit_exceeded');
  return { status: 'lexed', ...scanSource(source, { items: MAX_ITEMS }, 0) };
}
