import { posix } from 'node:path';
import { parseJsonWithoutDuplicateKeys } from '../outward-scanner.mjs';
import { createRootParserRegistry, ROOT_DIAGNOSTIC_CODES } from './root-api.mjs';
import { validateShell as validateShellCommand } from './posix-shell-validation.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const diagnosticCodes = new Set(Object.values(ROOT_DIAGNOSTIC_CODES));
const metadata = new Set(['name', 'version', 'description', 'keywords', 'license', 'author', 'contributors', 'homepage',
  'repository', 'bugs', 'funding', 'private', 'type', 'engines', 'os', 'cpu', 'packageManager',
  'dependencies', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'bundledDependencies']);
const fields = new Set(['scripts', 'bin', 'main', 'module', 'exports', 'files', 'workspaces', 'pnpm']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = (value) => value.replace(/~/g, '~0').replace(/\//g, '~1');
const stop = (code) => { throw code; };

// Strict UTF-8/RFC 8259, including duplicate keys in nested metadata. This helper
// can serve a future devcontainer adapter; it does not define that adapter's schema.
export function parseStrictJson(bytes) {
  try {
    if (!(bytes instanceof Uint8Array)) throw new Error();
    return parseJsonWithoutDuplicateKeys(decoder.decode(bytes));
  } catch {
    throw new Error('WP00 package: invalid_json');
  }
}

function staticText(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f]/.test(value)) stop('invalid_input');
  if (value.includes('${')) stop('unresolved_execution');
  return value;
}

function localTarget(value, exportTarget = false) {
  const target = staticText(value);
  if (posix.isAbsolute(target) || target.includes('\\') || target.split('/').includes('..') ||
    /^[a-z]+:/i.test(target) || (exportTarget && !target.startsWith('./'))) stop('unresolved_execution');
  return target;
}

// Shell admission is injected by trusted composition, never by package content.
// A validator is synchronous and returns the closed parsed/rejected result shape.
// No validator means scripts are unavailable, not implicitly safe or unsupported.
export function createPackageJsonParser({ validateShell = validateShellCommand } = {}) {
  return createRootParserRegistry({ package_json(input) {
    const reject = (code) => ({ status: 'rejected', edges: [], diagnostics: [{ code, line: null, column: null, field: null }] });
    try {
      if (posix.basename(input.path) !== 'package.json') return reject('parser_unavailable');
      let value;
      try { value = parseStrictJson(input.bytes); } catch { return reject('invalid_input'); }
      if (!object(value)) return reject('invalid_input');
      if (Object.keys(value).some((key) => !fields.has(key) && !metadata.has(key))) return reject('unsupported_syntax');
      const edges = [];
      const edge = (kind, field, target) => edges.push({ kind, field, target });
      const entries = (map) => {
        if (!object(map)) stop('invalid_input');
        return Object.entries(map);
      };
      const list = (items, field, kind) => {
        if (!Array.isArray(items)) stop('invalid_input');
        items.forEach((item, index) => edge(kind, `${field}/${index}`, localTarget(item)));
      };
      if (Object.hasOwn(value, 'pnpm')) {
        // pnpm 9 root policy, not evidence that dependency lifecycle code ran.
        // Root/workspace admission and lockfile/package integrity remain external.
        if (input.path !== 'package.json') stop('unresolved_execution');
        const policy = value.pnpm;
        if (!object(policy)) stop('invalid_input');
        if (Object.keys(policy).some((key) => !['onlyBuiltDependencies', 'overrides'].includes(key))) stop('unsupported_syntax');
        const packageName = (name) => typeof name === 'string' && name.length <= 214 && !['node_modules', 'favicon.ico'].includes(name) &&
          /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
        if (Object.hasOwn(policy, 'onlyBuiltDependencies')) {
          const allowed = policy.onlyBuiltDependencies;
          if (!Array.isArray(allowed) || !allowed.every(packageName)) stop('invalid_input');
          if (new Set(allowed).size !== allowed.length) stop('ambiguous_structure');
          // A present empty array disables dependency builds; absence does not.
          edge('environment', '/pnpm/onlyBuiltDependencies', JSON.stringify(allowed));
        }
        if (Object.hasOwn(policy, 'overrides')) {
          if (!object(policy.overrides)) stop('invalid_input');
          for (const [selector, replacement] of Object.entries(policy.overrides)) {
            if (!packageName(selector)) stop('unresolved_execution');
            // Exact stable registry versions only. No range solving, aliases,
            // local/git/URL protocols, parent selectors or $dependency lookup.
            if (typeof replacement !== 'string' || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(replacement)) stop('unresolved_execution');
            edge('environment', `/pnpm/overrides/${pointer(selector)}`, replacement);
          }
          if (Object.keys(policy.overrides).length === 0) edge('environment', '/pnpm/overrides', '{}');
        }
      }
      for (const field of ['main', 'module']) {
        if (Object.hasOwn(value, field)) edge('entry', `/${field}`, localTarget(value[field]));
      }
      if (Object.hasOwn(value, 'bin')) {
        if (typeof value.bin === 'string') edge('entry', '/bin', localTarget(value.bin));
        else for (const [name, target] of entries(value.bin)) edge('entry', `/bin/${pointer(name)}`, localTarget(target));
      }
      if (Object.hasOwn(value, 'files')) list(value.files, '/files', 'generated_output');
      if (Object.hasOwn(value, 'workspaces')) {
        let workspaces = value.workspaces;
        if (object(workspaces)) {
          if (Object.keys(workspaces).some((key) => key !== 'packages')) stop('unsupported_syntax');
          workspaces = workspaces.packages;
        }
        list(workspaces, '/workspaces', 'working_directory');
      }
      const exports = (item, field) => {
        if (item === null) return;
        if (typeof item === 'string') { edge('entry', field, localTarget(item, true)); return; }
        if (Array.isArray(item)) { item.forEach((child, index) => exports(child, `${field}/${index}`)); return; }
        const branches = entries(item);
        const subpaths = branches.filter(([key]) => key.startsWith('.'));
        if (subpaths.length && subpaths.length !== branches.length) stop('ambiguous_structure');
        for (const [index, [key, child]] of branches.entries()) {
          if (!key || /^\d+$/.test(key) || (key.startsWith('.') && key !== '.' && !key.startsWith('./'))) stop('invalid_input');
          // The ordinal preserves conditional object priority despite sorted output.
          exports(child, `${field}/${index}/${pointer(key)}`);
        }
      };
      if (Object.hasOwn(value, 'exports')) exports(value.exports, '/exports');
      if (Object.hasOwn(value, 'scripts')) {
        for (const [name, command] of entries(value.scripts)) {
          if (typeof command !== 'string') stop('invalid_input');
          if (typeof validateShell !== 'function') stop('parser_unavailable');
          const result = validateShell(command);
          if (!result || !Array.isArray(result.edges) || !Array.isArray(result.diagnostics)) stop('invalid_parser_result');
          if (result.status === 'rejected' && result.edges.length === 0 && result.diagnostics.length > 0) {
            const code = result.diagnostics[0]?.code;
            stop(diagnosticCodes.has(code) ? code : 'invalid_parser_result');
          }
          if (result.status !== 'parsed' || result.diagnostics.length !== 0) stop('invalid_parser_result');
          edge('command', `/scripts/${pointer(name)}`, command);
        }
      }
      return { status: 'parsed', edges, diagnostics: [] };
    } catch (error) {
      return reject(diagnosticCodes.has(error) ? error : 'parser_failure');
    }
  } });
}

export const parsePackageJson = createPackageJsonParser();
