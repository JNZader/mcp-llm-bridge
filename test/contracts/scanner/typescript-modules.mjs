import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';
import { encodePathsBin } from '../outward-scanner.mjs';
import { AST_LIMITS, inspectTypeScriptSyntax } from './typescript-ast.mjs';

export const VIRTUAL_ROOT = '/wp00-inventory';
export const INVENTORY_LIMITS = Object.freeze({ records: 2048, bytes: 8_388_608 });
const sourceExtension = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const fail = (code) => { throw new Error(code); };
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function virtualPath(name) {
  if (typeof name !== 'string' || /[\x00\\]/.test(name)) return undefined;
  const normalized = posix.normalize(posix.isAbsolute(name) ? name : `${VIRTUAL_ROOT}/${name}`);
  return normalized === VIRTUAL_ROOT || normalized.startsWith(`${VIRTUAL_ROOT}/`) ? normalized : undefined;
}

function rejected(code, status = 'rejected') {
  return Object.freeze({ schema: 'wp00-typescript-inventory/v1', status,
    evaluation: 'inventory_host_only', graph: 'not_evaluated', admission: 'not_evaluated',
    diagnostics: Object.freeze([Object.freeze({ code })]) });
}

// A text-inventory transport, not a Program, resolver, or closed module graph.
// Caller must explicitly select the future NodeNext policy; Bundler is distinct.
// Every supplied file is identity-checked, even JSON/configuration text. Config
// bytes are NOT compiler options or package-scope authority in this component.
// Binary inventory records are unsupported. No ambient lib/config/package reads.
export function createInventoryCompilerHost(observedRecords, policy) {
  if (policy !== 'nodenext-explicit-v1') return rejected('policy_unavailable', 'unavailable');
  if (ts.version !== '5.9.3') return rejected('parser_unavailable', 'unavailable');
  try {
    if (!Array.isArray(observedRecords)) return rejected('invalid_inventory');
    if (observedRecords.length > INVENTORY_LIMITS.records) return rejected('resource_limit');
    const files = new Map(), identities = [];
    let totalBytes = 0;
    for (const input of observedRecords) {
      if (!input || !(input.bytes instanceof Uint8Array)) return rejected('invalid_inventory');
      const { path, mode, length, sha256, targetPath } = input;
      if (typeof path !== 'string' || ![0o100644, 0o100755].includes(mode) || targetPath !== undefined ||
        typeof length !== 'bigint' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return rejected('invalid_inventory');
      totalBytes += input.bytes.byteLength;
      if (input.bytes.byteLength > AST_LIMITS.bytes || totalBytes > INVENTORY_LIMITS.bytes) return rejected('resource_limit');
      const bytes = Buffer.from(input.bytes);
      if (length !== BigInt(bytes.length) || createHash('sha256').update(bytes).digest('hex') !== sha256) return rejected('identity_mismatch');
      const identity = { path, mode, length, sha256 };
      identities.push(identity);
      // The shared codec rejects noncanonical paths, invalid modes and duplicates.
      const name = `${VIRTUAL_ROOT}/${path}`;
      let text;
      try { text = decoder.decode(bytes); } catch { return rejected('invalid_utf8'); }
      if (sourceExtension.test(path)) {
        const syntax = inspectTypeScriptSyntax({ ...identity, bytes });
        if (syntax.status !== 'inspected') return rejected('invalid_source');
      }
      files.set(name, { text, source: sourceExtension.test(path) });
    }
    encodePathsBin(identities.map((identity) => ({ ...identity, sha256: Buffer.from(identity.sha256, 'hex') })));
    identities.sort((a, b) => byteOrder(a.path, b.path));
    const directories = new Set([VIRTUAL_ROOT]);
    for (const name of files.keys()) {
      let directory = posix.dirname(name);
      while (directory.startsWith(`${VIRTUAL_ROOT}/`)) {
        directories.add(directory);
        directory = posix.dirname(directory);
      }
    }
    const getSourceFile = (name, languageVersion) => {
      const path = virtualPath(name), file = files.get(path);
      if (!file?.source) return undefined;
      // Fresh ASTs prevent caller mutation from changing the captured inventory.
      // Package type/impliedNodeFormat is the future explicit resolver's concern.
      return ts.createSourceFile(path, file.text, languageVersion, true);
    };
    const host = Object.freeze({
      getSourceFile,
      getSourceFileByPath: (name, _path, languageVersion) => getSourceFile(name, languageVersion),
      readFile: (name) => files.get(virtualPath(name))?.text,
      fileExists: (name) => files.has(virtualPath(name)),
      directoryExists: (name) => directories.has(virtualPath(name)),
      getDirectories: (name) => {
        const directory = virtualPath(name);
        return directory ? [...directories].filter((entry) => entry !== directory && posix.dirname(entry) === directory)
          .map((entry) => posix.basename(entry)).sort(byteOrder) : [];
      },
      getCurrentDirectory: () => VIRTUAL_ROOT,
      getCanonicalFileName: (name) => virtualPath(name) ?? '/wp00-unavailable',
      realpath: (name) => virtualPath(name) ?? '/wp00-unavailable',
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      getDefaultLibFileName: () => '/wp00-unavailable/lib.d.ts',
      getDefaultLibLocation: () => '/wp00-unavailable',
      writeFile: () => fail('write_forbidden'),
      createDirectory: () => fail('write_forbidden'),
      readDirectory: () => fail('directory_glob_unavailable'),
      trace: () => {},
      resolveModuleNames: (names) => names.map(() => undefined),
      resolveModuleNameLiterals: (names) => names.map(() => ({ resolvedModule: undefined })),
      resolveTypeReferenceDirectives: (names) => names.map(() => undefined),
      resolveTypeReferenceDirectiveReferences: (names) => names.map(() => ({ resolvedTypeReferenceDirective: undefined })),
    });
    return Object.freeze({ schema: 'wp00-typescript-inventory/v1', status: 'available',
      evaluation: 'inventory_host_only', graph: 'not_evaluated', admission: 'not_evaluated',
      policy, host, identities: Object.freeze(identities.map(Object.freeze)),
      rootNames: Object.freeze(identities.filter((identity) => sourceExtension.test(identity.path))
        .map((identity) => `${VIRTUAL_ROOT}/${identity.path}`)), diagnostics: Object.freeze([]) });
  } catch {
    return rejected('invalid_inventory');
  }
}
