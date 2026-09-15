import { posix } from 'node:path';
import ts from 'typescript';
import { createInventoryCompilerHost, VIRTUAL_ROOT } from './typescript-modules.mjs';
import { parseStrictJson } from './package-json.mjs';

export const NODE_NEXT_SOURCE_LIMIT = 128;
const failure = (code, status = 'rejected') => Object.freeze({ status, code });

// Internal scanner seam, not an admission API. The mutable Compiler API Program
// is inspection-local and must never be returned in public scanner results.
// Every call captures a new immutable inventory and builds a fresh Program;
// callers cannot mutate authority shared with another inspection. Resolution,
// package scope, diagnostics, noLib/noEmit and host restrictions are unchanged.
export function createNodeNextProgramContext(records, policy) {
  const inventory = createInventoryCompilerHost(records, policy);
  if (inventory.status !== 'available') return failure(inventory.diagnostics[0].code, inventory.status);
  if (inventory.rootNames.length > NODE_NEXT_SOURCE_LIMIT) return failure('resource_limit');
  try {
    const base = inventory.host, packages = new Map();
    for (const item of inventory.identities) {
      if (posix.basename(item.path) !== 'package.json') continue;
      const value = parseStrictJson(Buffer.from(base.readFile(item.path)));
      if (!value || Array.isArray(value) || typeof value !== 'object') return failure('invalid_package_scope');
      packages.set(posix.dirname(`${VIRTUAL_ROOT}/${item.path}`), value.type);
    }
    for (const path of inventory.rootNames) {
      if (/\.(?:cts|cjs)$/.test(path)) return failure('commonjs_unavailable', 'unavailable');
      if (/\.(?:mts|mjs)$/.test(path)) continue;
      let directory = posix.dirname(path), type;
      while (directory === VIRTUAL_ROOT || directory.startsWith(`${VIRTUAL_ROOT}/`)) {
        if (packages.has(directory)) { type = packages.get(directory); break; }
        directory = posix.dirname(directory);
      }
      if (type !== 'module') return failure(type === 'commonjs' ? 'commonjs_unavailable' : 'package_scope_unavailable', 'unavailable');
    }
    const sourceNames = new Set(inventory.rootNames);
    const resolve = (specifier, containingFile) => {
      if (typeof specifier !== 'string') return { code: 'computed_reference' };
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return { code: 'external_reference' };
      if (/[\\\x00?#%]/.test(specifier)) return { code: 'unsupported_reference' };
      const path = posix.normalize(posix.join(posix.dirname(containingFile), specifier));
      if (!path.startsWith(`${VIRTUAL_ROOT}/`)) return { code: 'outside_inventory' };
      const extension = posix.extname(path);
      const substitutions = extension === '.js' ? ['.ts', '.tsx', '.d.ts', '.js', '.jsx'] :
        extension === '.mjs' ? ['.mts', '.d.mts', '.mjs'] : null;
      if (!substitutions) return { code: 'unsupported_extension' };
      const stem = path.slice(0, -extension.length);
      const candidates = substitutions.map((suffix) => stem + suffix).filter((name) => sourceNames.has(name));
      if (candidates.length !== 1) return { code: candidates.length ? 'ambiguous_reference' : 'missing_reference' };
      const resolvedFileName = candidates[0];
      const extensionKind = resolvedFileName.endsWith('.d.mts') ? ts.Extension.Dmts :
        resolvedFileName.endsWith('.d.ts') ? ts.Extension.Dts :
        ({ '.ts': ts.Extension.Ts, '.tsx': ts.Extension.Tsx, '.js': ts.Extension.Js,
          '.jsx': ts.Extension.Jsx, '.mts': ts.Extension.Mts, '.mjs': ts.Extension.Mjs })[posix.extname(resolvedFileName)];
      return { resolvedFileName, extension: extensionKind, isExternalLibraryImport: false };
    };
    const getSourceFile = (name) => base.getSourceFile(name,
      { languageVersion: ts.ScriptTarget.ESNext, impliedNodeFormat: ts.ModuleKind.ESNext });
    const host = { ...base, getSourceFile,
      getSourceFileByPath: (name) => getSourceFile(name),
      resolveModuleNameLiterals: (names, containingFile) => names.map((name) => {
        const result = resolve(name.text, containingFile);
        return { resolvedModule: result.code ? undefined : result };
      }) };
    const program = ts.createProgram({ rootNames: [...inventory.rootNames], host, options: {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext, noLib: true, types: [], noEmit: true,
      allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, skipLibCheck: true,
    } });
    if (program.getSyntacticDiagnostics().length || program.getOptionsDiagnostics().length) return failure('program_diagnostic');
    return Object.freeze({ status: 'available', inventory, program, resolve,
      hasSource: (name) => sourceNames.has(name) });
  } catch {
    return failure('invalid_graph');
  }
}
