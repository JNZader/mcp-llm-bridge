import { decodeBoundedYaml, YAML_SCALAR } from './bounded-yaml.mjs';

const stop = (code = 'invalid_input') => { throw Object.assign(new Error('WP00 Compose value rejected'), { code }); };
export function isComposeNull(value) {
  return value == null || (value[YAML_SCALAR] && value.style === 'plain' && /^(?:null|Null|NULL|~)$/.test(value.value));
}

// No ambient environment lookup. $$ is Compose's literal-dollar escape;
// unresolved interpolation cannot silently become an empty host-derived value.
export function composeText(value) {
  if (!value?.[YAML_SCALAR]) stop();
  if (value.style === 'plain' && /^(?:null|~|true|false|[-+]?(?:[0-9].*|\.[0-9].*|\.inf)|\.nan)$/i.test(value.value)) stop();
  let result = '';
  for (let index = 0; index < value.value.length; index += 1) {
    const char = value.value[index];
    if (char !== '$') { result += char; continue; }
    if (value.value[index + 1] !== '$') stop('unresolved_execution');
    result += '$'; index += 1;
  }
  return result;
}

// Bounded command-string word decoding, NOT a shell interpreter. Operators and
// substitution-looking unquoted groups reject rather than being partly parsed.
// Explicit sh -c bodies survive as a single quoted argument for later validation.
export function tokenizeComposeCommand(source) {
  if (typeof source !== 'string' || source.length > 65536 || source.includes('\0')) stop();
  const argv = [];
  let word = '', active = false, quote = null;
  const flush = () => {
    if (active) argv.push(word);
    word = ''; active = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\' && quote !== "'") {
      if (++index === source.length) stop();
      const next = source[index];
      word += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      active = true;
    } else if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      active = true;
    } else if (!quote && /[ \t\r\n]/.test(char)) flush();
    else {
      if (!quote && /[;&|<>()`]/.test(char)) stop('unsupported_syntax');
      word += char; active = true;
    }
  }
  if (quote) stop();
  flush();
  return argv;
}

// null means inherit; [] and empty string mean explicit empty override.
export function composeCommand(value) {
  if (isComposeNull(value)) return null;
  if (Array.isArray(value)) return value.map(composeText);
  return tokenizeComposeCommand(composeText(value));
}

export function decodeComposeValues(source) {
  try {
    const result = decodeBoundedYaml(source, { preserveScalarStyle: true, allowEmptySequences: true });
    return { status: 'decoded', value: result.value };
  } catch {
    return { status: 'rejected', diagnostics: [{ code: 'invalid_input', line: null, column: null, field: null }] };
  }
}
