import { parseStrictJson } from './package-json.mjs';

const instructions = new Set(['FROM', 'RUN', 'CMD', 'ENTRYPOINT', 'COPY', 'ADD', 'WORKDIR', 'USER', 'ENV']);
const jsonForms = new Set(['RUN', 'CMD', 'ENTRYPOINT', 'COPY', 'ADD']);
const allowedFlags = { FROM: ['platform'], COPY: ['from', 'chown', 'chmod'], ADD: ['chown', 'chmod'] };
const stop = (code) => { throw code; };

// Lexical component only: decoded instructions do not admit an execution root.
// In particular, JSON argv is never joined into shell source or expanded here.
// Stage inheritance, image configuration and effective CMD/ENTRYPOINT belong
// to the semantic adapter, which must obtain separately trusted image metadata.
export function decodeDockerfile(source) {
  try {
    if (typeof source !== 'string' || source.length > 65536 || /[\x00\ufeff]/.test(source)) stop('invalid_input');
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    if (lines.some((line) => line.includes('\r'))) stop('invalid_input');
    const result = [];
    let escape = '\\';
    let directiveRegion = true;
    let seenEscape = false;
    let pending = null;
    let startLine = 0;
    const emit = (raw, endLine) => {
      const match = /^([A-Za-z]+)[ \t]+([\s\S]+)$/.exec(raw);
      if (!match) stop('invalid_input');
      const instruction = match[1].toUpperCase();
      if (!instructions.has(instruction)) stop('unsupported_syntax');
      let argument = match[2];
      const flags = Object.create(null);
      while (argument.startsWith('--')) {
        const flag = /^--([a-z]+)=([^ \t]+)[ \t]+([\s\S]+)$/.exec(argument);
        if (!flag || !allowedFlags[instruction]?.includes(flag[1])) stop('unsupported_syntax');
        if (Object.hasOwn(flags, flag[1])) stop('ambiguous_structure');
        flags[flag[1]] = flag[2];
        argument = flag[3];
      }
      let argv = null;
      let form = 'text';
      if (argument.startsWith('[')) {
        if (!jsonForms.has(instruction)) stop('unsupported_syntax');
        argv = parseStrictJson(Buffer.from(argument));
        if (!Array.isArray(argv) || argv.some((item) => typeof item !== 'string' || item.includes('\0'))) stop('invalid_input');
        form = 'json';
      } else {
        if (argument.includes('<<')) stop('unsupported_syntax');
        if (['RUN', 'CMD', 'ENTRYPOINT'].includes(instruction)) form = 'shell';
      }
      result.push({ instruction, argument, form, argv, flags, startLine, endLine });
      if (result.length > 4096) stop('invalid_input');
    };
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) {
        const directive = /^#[ \t]*(escape|syntax|check)[ \t]*=[ \t]*(.*)$/i.exec(trimmed);
        if (directive) {
          // A late directive is ignored by Docker; reject this ambiguous spelling
          // rather than silently applying it to an already-started instruction.
          if (!directiveRegion || pending !== null || seenEscape) stop('ambiguous_structure');
          if (directive[1].toLowerCase() !== 'escape') stop('unsupported_syntax');
          const value = directive[2].trim();
          if (!['\\', '`'].includes(value)) stop('invalid_input');
          escape = value;
          seenEscape = true;
          continue;
        }
        directiveRegion = false;
        continue;
      }
      directiveRegion = false;
      if (!trimmed) continue;
      if (pending === null) startLine = index + 1;
      const content = pending === null ? trimmed : line;
      let end = content.length;
      while (end > 0 && /[ \t]/.test(content[end - 1])) end -= 1;
      let escapes = 0;
      while (content[end - 1 - escapes] === escape) escapes += 1;
      const continued = escapes % 2 === 1;
      const piece = continued ? content.slice(0, end - 1) : content;
      pending = (pending ?? '') + piece;
      if (!continued) {
        emit(pending, index + 1);
        pending = null;
      }
    }
    if (pending !== null || !result.length) stop('invalid_input');
    return { status: 'decoded', escape, instructions: result };
  } catch (error) {
    const code = ['invalid_input', 'unsupported_syntax', 'ambiguous_structure'].includes(error) ? error : 'invalid_input';
    return { status: 'rejected', instructions: [], diagnostics: [{ code, line: null, column: null, field: null }] };
  }
}
