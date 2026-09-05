// Bounded block-style decoding, NOT application-schema validation or root admission.
// Scalars remain strings (no implicit boolean/date/number coercion); empty nodes
// are null. Supports maps, sequences, inline sequence maps, single-line quoted
// scalars and |/> blocks. Flow collections, tags, anchors, aliases and merges reject.
// Scalar semantics: https://yaml.org/spec/1.2.2/ sections 7.3 and 8.1.
const fail = () => { throw new Error('WP00 YAML: unsupported_or_invalid'); };
const indent = (line) => /^ */.exec(line)[0].length;
const escapeValues = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r',
  e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029' };

function comment(text) {
  let quote = null;
  let atStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"' && char === '\\') { index += 1; continue; }
    if (quote === "'" && char === "'" && text[index + 1] === "'") { index += 1; continue; }
    if (char === quote) { quote = null; atStart = false; continue; }
    if (!quote && atStart && (char === '"' || char === "'")) { quote = char; continue; }
    if (!quote) {
      if (char === '#' && (index === 0 || /[ \t]/.test(text[index - 1]))) return text.slice(0, index).trimEnd();
      if (char === ':' && /[ \t]/.test(text[index + 1] ?? '')) atStart = true;
      else if (!(index === 0 && char === '-' && /[ \t]/.test(text[index + 1] ?? '')) && !/[ \t]/.test(char)) atStart = false;
    }
  }
  return text.trimEnd();
}

function scalar(text) {
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) fail();
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) fail();
    return text.slice(1, -1).replace(/\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (escape) => {
      const key = escape[1];
      if (['x', 'u', 'U'].includes(key)) {
        const length = { x: 2, u: 4, U: 8 }[key];
        if (escape.length !== length + 2) fail();
        const code = Number.parseInt(escape.slice(2), 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail();
        return String.fromCodePoint(code);
      }
      if (!Object.hasOwn(escapeValues, key)) fail();
      return escapeValues[key];
    });
  }
  if (!text || /^[!&*\[\]{}|>%@`]/.test(text) || /^[-?:](?:\s|$)/.test(text) || /:\s/.test(text)) fail();
  return text;
}

function pair(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"' && char === '\\') { index += 1; continue; }
    if (quote === "'" && char === "'" && text[index + 1] === "'") { index += 1; continue; }
    if (char === quote) quote = null;
    else if (index === 0 && (char === '"' || char === "'")) quote = char;
    else if (!quote && char === ':' && (index + 1 === text.length || /[ \t]/.test(text[index + 1]))) {
      return [scalar(text.slice(0, index).trimEnd()), text.slice(index + 1).trimStart()];
    }
  }
  return null;
}

export function decodeBoundedYaml(source) {
  if (typeof source !== 'string' || source.length > 65_536 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f\ufeff]/.test(source)) fail();
  source = source.replace(/\r\n?/g, '\n');
  const lines = source.split('\n').map((text, index, all) => ({ text, break: index < all.length - 1 }));
  if (source.endsWith('\n')) lines.pop();
  let index = 0;
  let budget = 8_192;
  const skip = () => {
    while (index < lines.length && (!lines[index].text.trim() || lines[index].text.trimStart().startsWith('#'))) index += 1;
  };
  const block = (header, parent) => {
    const match = /^([|>])(?:([1-9])([+-]?)|([+-])([1-9]?))?$/.exec(header);
    if (!match) fail();
    const explicit = match[2] || match[5];
    const chomp = match[3] || match[4] || '';
    let width = explicit ? parent + Number(explicit) : null;
    const content = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.text.trim() && indent(line.text) <= parent) break;
      if (line.text.trim() && width === null) width = indent(line.text);
      if (line.text.trim() && indent(line.text) < width) fail();
      content.push(line);
      index += 1;
    }
    width ??= parent + 1;
    const firstText = content.findIndex((line) => line.text.trim());
    if (!explicit && content.slice(0, firstText < 0 ? content.length : firstText).some((line) => line.text.length > width)) fail();
    const body = content.map((line) => ({ text: line.text.slice(width), break: line.break }));
    let result = '';
    for (let current = 0; current < body.length;) {
      const line = body[current];
      result += line.text;
      if (match[1] === '|' || !line.text) {
        result += line.break ? '\n' : '';
        current += 1;
        continue;
      }
      let next = current + 1;
      while (next < body.length && !body[next].text) next += 1;
      const breaks = body.slice(current, next).filter((item) => item.break).length;
      if (next < body.length && !/^[ \t]/.test(line.text) && !/^[ \t]/.test(body[next].text)) {
        result += breaks === 1 ? ' ' : '\n'.repeat(Math.max(0, breaks - 1));
      } else result += '\n'.repeat(breaks);
      current = next;
    }
    if (chomp === '+') return result;
    const stripped = result.replace(/\n+$/, '');
    return chomp === '-' || !stripped || !result.endsWith('\n') ? stripped : stripped + '\n';
  };
  const node = (level, depth) => {
    if (depth > 32 || --budget < 0) fail();
    skip();
    if (index === lines.length || indent(lines[index].text) !== level) fail();
    const sequence = /^-(?:\s|$)/.test(lines[index].text.slice(level));
    const value = sequence ? [] : Object.create(null);
    while (index < lines.length) {
      skip();
      if (index === lines.length || indent(lines[index].text) < level) break;
      if (--budget < 0 || indent(lines[index].text) !== level) fail();
      const text = comment(lines[index].text.slice(level));
      if (text.startsWith('\t') || text === '---' || text === '...') fail();
      const isItem = /^-(?:\s|$)/.test(text);
      if (isItem !== sequence) break;
      if (sequence) {
        const rest = text.slice(1).trimStart();
        if (pair(rest)) {
          lines[index] = { ...lines[index], text: ' '.repeat(level + 2) + rest };
          value.push(node(level + 2, depth + 1));
        } else {
          index += 1;
          if (/^[|>]/.test(rest)) { value.push(block(rest, level)); continue; }
          skip();
          value.push(rest ? scalar(rest) : index < lines.length && indent(lines[index].text) > level ? node(indent(lines[index].text), depth + 1) : null);
        }
      } else {
        const entry = pair(text);
        if (!entry || entry[0] === '<<' || Object.hasOwn(value, entry[0])) fail();
        index += 1;
        const [key, rest] = entry;
        if (/^[|>]/.test(rest)) value[key] = block(rest, level);
        else if (rest) value[key] = scalar(rest);
        else {
          skip();
          const nextLevel = index < lines.length ? indent(lines[index].text) : -1;
          const indentlessList = nextLevel === level && /^-(?:\s|$)/.test(lines[index].text.slice(level));
          value[key] = nextLevel > level || indentlessList ? node(nextLevel, depth + 1) : null;
        }
      }
    }
    return value;
  };
  skip();
  const value = index === lines.length ? null : node(0, 0);
  skip();
  if (index !== lines.length) fail();
  return { status: 'decoded', value };
}
