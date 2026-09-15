import { createHash } from 'node:crypto';
import { canonicalizeJcs, encodePathsBin } from '../outward-scanner.mjs';

export const ROOT_PARSERS = Object.freeze({
  package_json: 'package-json-v1',
  posix_shell: 'posix-shell-v1',
  github_actions: 'github-actions-yaml-v1',
  dockerfile: 'dockerfile-v1',
  compose: 'compose-yaml-v1',
  generated_config: 'root-integration-v1',
  executable_file: 'root-inventory-v1',
});
export const ROOT_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_INPUT: 'invalid_input',
  AUTHORITY_MISMATCH: 'authority_mismatch',
  PARSER_UNAVAILABLE: 'parser_unavailable',
  UNSUPPORTED_SYNTAX: 'unsupported_syntax',
  AMBIGUOUS_STRUCTURE: 'ambiguous_structure',
  UNRESOLVED_EXECUTION: 'unresolved_execution',
  INVALID_PARSER_RESULT: 'invalid_parser_result',
  PARSER_FAILURE: 'parser_failure',
});
const codes = new Set(Object.values(ROOT_DIAGNOSTIC_CODES));
const edgeKinds = new Set(['entry', 'command', 'working_directory', 'mount', 'environment', 'image', 'generated_output']);
const hashPattern = /^[0-9a-f]{64}$/;
const identityPattern = /^sha256:[0-9a-f]{64}$/;
const hasKind = (kind) => Object.hasOwn(ROOT_PARSERS, kind);
const byteCompare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const position = (value) => value === null || (Number.isSafeInteger(value) && value > 0);

function validRecord(record) {
  if (!record || typeof record.sha256 !== 'string' || !hashPattern.test(record.sha256) || typeof record.length !== 'bigint') return false;
  try {
    encodePathsBin([{ ...record, sha256: Buffer.from(record.sha256, 'hex') }]);
    return true;
  } catch {
    return false;
  }
}

function diagnostic(code, path) {
  return { code, path, line: null, column: null, field: null };
}

function normalizeResult(result, path) {
  if (!result || !Array.isArray(result.edges) || !Array.isArray(result.diagnostics)) return null;
  if (result.status === 'parsed' && result.diagnostics.length === 0) {
    if (!result.edges.every((edge) => edge && edgeKinds.has(edge.kind) && typeof edge.field === 'string' && typeof edge.target === 'string')) return null;
    const edges = result.edges.map(({ kind, field, target }) => ({ kind, field, target }));
    return { status: 'parsed', edges: edges.sort((a, b) => byteCompare(canonicalizeJcs(a), canonicalizeJcs(b))), diagnostics: [] };
  }
  if (result.status !== 'rejected' || result.edges.length !== 0 || result.diagnostics.length === 0) return null;
  if (!result.diagnostics.every((item) => item && codes.has(item.code) && position(item.line) && position(item.column) &&
    (item.field === null || (typeof item.field === 'string' && /^[a-z_][a-z0-9_.]*$/.test(item.field))))) return null;
  const diagnostics = result.diagnostics.map(({ code, line, column, field }) => ({ code, path, line, column, field }));
  diagnostics.sort((a, b) => (a.line ?? -1) - (b.line ?? -1) || (a.column ?? -1) - (b.column ?? -1) ||
    byteCompare(a.field ?? '', b.field ?? '') || byteCompare(a.code, b.code));
  return { status: 'rejected', edges: [], diagnostics };
}

// Entries are trusted internal grammar implementations, never supplied by scanned input.
// The captured registry cannot be changed by mutating the caller's registration object.
export function createRootParserRegistry(entries = {}) {
  const parsers = new Map(Object.entries(entries));
  for (const [kind, parser] of parsers) {
    if (!hasKind(kind) || typeof parser !== 'function') throw new TypeError('Invalid root parser registration');
  }
  return function parseExecutionRoot(input, expected) {
    const knownKind = typeof input?.rootKind === 'string' && hasKind(input.rootKind);
    const validInput = knownKind && input.schema === 'wp00-root-input/v1' && validRecord(input) && input.bytes instanceof Uint8Array;
    // Malformed calls use fixed metadata; never reflect unvalidated input or exception text.
    const metadata = {
      rootKind: knownKind ? input.rootKind : 'executable_file',
      path: validInput ? input.path : '',
      parserId: knownKind ? ROOT_PARSERS[input.rootKind] : ROOT_PARSERS.executable_file,
      parserVersion: 1,
      inputSha256: validInput ? input.sha256 : '',
    };
    const reject = (code) => ({ ...metadata, status: 'rejected', edges: [], diagnostics: [diagnostic(code, metadata.path)] });
    if (!validInput) return reject(ROOT_DIAGNOSTIC_CODES.INVALID_INPUT);
    // Admission of binding/artifact identities belongs to the caller. Shape validation
    // here is not cryptographic admission and cannot turn input into its own authority.
    if (expected?.schema !== 'wp00-root-authority/v1' || typeof expected.bindingHash !== 'string' || !identityPattern.test(expected.bindingHash) ||
      typeof expected.wp00ArtifactHash !== 'string' || !identityPattern.test(expected.wp00ArtifactHash) || !validRecord(expected.record) ||
      !Array.isArray(expected.inventoryPaths) || expected.inventoryPaths.filter((path) => path === expected.record.path).length !== 1 ||
      ['path', 'mode', 'length', 'sha256'].some((field) => input[field] !== expected.record[field])) {
      return reject(ROOT_DIAGNOSTIC_CODES.AUTHORITY_MISMATCH);
    }
    const bytes = Uint8Array.from(input.bytes);
    if (BigInt(bytes.byteLength) !== input.length || createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
      return reject(ROOT_DIAGNOSTIC_CODES.AUTHORITY_MISMATCH);
    }
    const parser = parsers.get(input.rootKind);
    if (!parser) return reject(ROOT_DIAGNOSTIC_CODES.PARSER_UNAVAILABLE);
    try {
      const result = normalizeResult(parser(Object.freeze({ ...input, bytes })), input.path);
      return result ? { ...metadata, ...result } : reject(ROOT_DIAGNOSTIC_CODES.INVALID_PARSER_RESULT);
    } catch {
      return reject(ROOT_DIAGNOSTIC_CODES.PARSER_FAILURE);
    }
  };
}

// Grammar units install their implementations during aggregate integration. Until
// then, valid roots report unavailable, not unsupported or falsely parsed.
export const parseExecutionRoot = createRootParserRegistry();
