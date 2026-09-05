import { posix } from 'node:path';
import { tokenizeShell } from './posix-shell.mjs';
import { createRootParserRegistry } from './root-api.mjs';
import { canonicalizeJcs } from '../outward-scanner.mjs';

const stop = (code) => { throw code; };
const codes = new Set(['invalid_input', 'unsupported_syntax', 'unresolved_execution']);
const reserved = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', '{', '}', '!', 'function']);
const opaqueWrappers = new Set(['.', 'source', 'alias', 'unalias', 'builtin', 'xargs', 'sudo', 'doas', 'su', 'timeout', 'nice', 'nohup', 'setsid', 'watch']);
const shells = new Set(['sh', 'bash', 'dash', 'ksh', 'zsh']);
const rejection = (code) => ({ status: 'rejected', edges: [], diagnostics: [{ code, line: null, column: null, field: null }] });
const literal = (word) => word.parts.every((part) => part.kind === 'literal') ? word.parts.map((part) => part.value).join('') : null;
const assignment = (stream, word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(stream.source.slice(word.start, word.end));

// This validates a bounded shell grammar and inventories execution references.
// It never executes text or proves arbitrary external programs safe. PATH lookup,
// referenced script bytes and executable behavior remain aggregate/AST obligations.
export function validateShell(source) {
  const edges = [];
  const edge = (kind, target) => edges.push({ kind, field: `/shell/${edges.length}`, target });
  const validate = (stream, depth, requireCommand = false) => {
    if (depth > 32) stop('unresolved_execution');
    const inspect = (word) => {
      for (const part of word.parts) {
        if (part.kind === 'substitution') validate(part.stream, depth + 1);
        if (part.kind === 'parameter' && !/^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!\-]|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(part.raw)) {
          stop('unresolved_execution');
        }
      }
    };
    const staticWord = (word) => {
      if (!word) stop('unresolved_execution');
      const value = literal(word);
      if (value === null) stop('unresolved_execution');
      return value;
    };
    const command = (words) => {
      words.forEach(inspect);
      let index = 0;
      while (index < words.length && assignment(stream, words[index])) {
        edge('environment', stream.source.slice(words[index].start, words[index].end));
        index += 1;
      }
      while (index < words.length) {
        const head = words[index++];
        const executable = staticWord(head);
        if (!executable || head.parts.some((part) => part.quote === 'unquoted' && /[*?\[~]/.test(part.value))) stop('unresolved_execution');
        const name = posix.basename(executable);
        if (reserved.has(name)) stop('unsupported_syntax');
        if (opaqueWrappers.has(name)) stop('unresolved_execution');
        edge('entry', executable);
        if (name === 'env' || name === 'command' || name === 'exec') {
          while (index < words.length) {
            const option = literal(words[index]);
            if (option === '--') { index += 1; break; }
            if ((name === 'env' && ['-i', '--ignore-environment'].includes(option)) || (name === 'command' && option === '-p')) { index += 1; continue; }
            if (name === 'env' && assignment(stream, words[index])) {
              edge('environment', stream.source.slice(words[index].start, words[index].end));
              index += 1;
              continue;
            }
            if (option?.startsWith('-')) stop('unresolved_execution');
            break;
          }
          if (index === words.length && name !== 'env' && name !== 'exec') stop('invalid_input');
          continue;
        }
        if (name === 'eval') {
          const text = words.slice(index).map(staticWord).join(' ');
          validate(tokenizeShell(text), depth + 1);
        } else if (shells.has(name)) {
          if (staticWord(words[index]) === '-c') {
            validate(tokenizeShell(staticWord(words[index + 1])), depth + 1);
          } else {
            const file = staticWord(words[index]);
            if (file.startsWith('-')) stop('unresolved_execution');
            edge('entry', file);
          }
        } else {
          const args = words.slice(index).map(literal);
          if (name === 'find' && args.some((arg) => arg === null || ['-exec', '-execdir', '-ok', '-okdir'].includes(arg))) {
            stop('unresolved_execution');
          }
          if (/^(?:node|nodejs|python[0-9.]*|perl|ruby)$/.test(name)) {
            for (let option = index; option < words.length; option += 1) {
              const value = staticWord(words[option]);
              if (!value.startsWith('-')) { edge('entry', value); break; }
              if (['node', 'nodejs'].includes(name) && ['--import', '--require', '-r'].includes(value)) {
                edge('entry', staticWord(words[++option]));
              } else if (!['--test', '--version', '-v', '--help'].includes(value)) stop('unresolved_execution');
            }
          }
        }
        break;
      }
      edge('command', stream.source.slice(words[0].start, words.at(-1).end));
    };
    let index = 0;
    let expecting = true;
    let pending = null;
    let seen = false;
    while (index < stream.tokens.length) {
      const token = stream.tokens[index];
      if (token.kind === 'operator') {
        index += 1;
        if (token.value === '\n') { if (!expecting) { expecting = true; pending = null; } continue; }
        if (![';', '|', '&&', '||'].includes(token.value)) stop('unsupported_syntax');
        if (expecting) stop('invalid_input');
        expecting = true;
        pending = token.value === ';' ? null : token.value;
        continue;
      }
      if (!expecting) stop('invalid_input');
      if (token.kind === 'group') {
        validate(token.stream, depth + 1, true);
        index += 1;
      } else {
        const words = [];
        while (stream.tokens[index]?.kind === 'word') words.push(stream.tokens[index++]);
        command(words);
      }
      expecting = false;
      pending = null;
      seen = true;
    }
    if (pending || (requireCommand && !seen)) stop('invalid_input');
  };
  try {
    validate(tokenizeShell(source), 0);
    edges.sort((a, b) => Buffer.compare(Buffer.from(canonicalizeJcs(a)), Buffer.from(canonicalizeJcs(b))));
    return { status: 'parsed', edges, diagnostics: [] };
  } catch (error) {
    return rejection(codes.has(error) ? error : error?.code === 'unsupported_arithmetic' ? 'unsupported_syntax' : 'invalid_input');
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export const parsePosixShell = createRootParserRegistry({ posix_shell(input) {
  try { return validateShell(decoder.decode(input.bytes)); } catch { return rejection('invalid_input'); }
} });
