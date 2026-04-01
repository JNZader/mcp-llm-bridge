/**
 * Multi-hop import resolution for code search.
 *
 * Parses import/require statements from source files and
 * follows them to find related code chunks across files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import type { SearchResult } from './types.js';
import { DEFAULT_EXTENSIONS } from './types.js';
import type { SearchIndex } from './indexer.js';

/** An import reference extracted from a source file. */
export interface ImportRef {
  /** The import specifier (path or package name). */
  specifier: string;
  /** Resolved absolute path (if resolvable). */
  resolvedPath: string | null;
  /** Imported symbols (empty = star/default import). */
  symbols: string[];
}

/**
 * Pattern definition with explicit group semantics.
 */
interface ImportPattern {
  regex: RegExp;
  /** Extract specifier and symbols from a match. */
  extract: (match: RegExpExecArray) => { specifier: string; symbols: string[] } | null;
}

/**
 * Import patterns with explicit extraction logic per pattern type.
 */
const IMPORT_PATTERNS: ImportPattern[] = [
  {
    // ES named import: import { X, Y } from './path'
    regex: /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[2] ?? '',
      symbols: (m[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean),
    }),
  },
  {
    // ES default import: import X from './path'
    regex: /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[2] ?? '',
      symbols: [m[1] ?? ''].filter(Boolean),
    }),
  },
  {
    // ES star import: import * as X from './path'
    regex: /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[2] ?? '',
      symbols: [m[1] ?? ''].filter(Boolean),
    }),
  },
  {
    // ES side-effect import: import './path'
    regex: /import\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[1] ?? '',
      symbols: [],
    }),
  },
  {
    // CommonJS require: const { X } = require('./path') or const X = require('./path')
    regex: /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extract: (m) => ({
      specifier: m[3] ?? '',
      symbols: (m[1] ?? m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    }),
  },
  {
    // Python: from module import X, Y
    regex: /from\s+(\S+)\s+import\s+(.+)/g,
    extract: (m) => ({
      specifier: m[1] ?? '',
      symbols: (m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    }),
  },
  {
    // Go import: import "package/path"
    regex: /import\s+(?:\w+\s+)?"([^"]+)"/g,
    extract: (m) => ({
      specifier: m[1] ?? '',
      symbols: [],
    }),
  },
];

/**
 * Extract import references from file content.
 */
export function extractImports(filePath: string, content: string): ImportRef[] {
  const imports: ImportRef[] = [];
  const dir = dirname(filePath);
  const seen = new Set<string>();

  for (const { regex, extract } of IMPORT_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      const result = extract(match);
      if (!result) continue;

      const { specifier, symbols } = result;

      if (!specifier || seen.has(specifier)) continue;
      seen.add(specifier);

      // Resolve relative paths
      const resolvedPath = resolveImportPath(specifier, dir);

      imports.push({ specifier, resolvedPath, symbols });
    }
  }

  return imports;
}

/**
 * Resolve a relative import specifier to an absolute file path.
 * Tries common extensions if none specified.
 */
function resolveImportPath(specifier: string, fromDir: string): string | null {
  // Skip bare/package imports
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  const base = resolve(fromDir, specifier);

  // If it already has an extension, check directly
  if (extname(base)) {
    return existsSync(base) ? base : null;
  }

  // Try common extensions
  for (const ext of DEFAULT_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  // Try index files
  for (const ext of DEFAULT_EXTENSIONS) {
    const candidate = resolve(base, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Follow imports from matched chunks to find related code.
 *
 * @param matchedChunks - Chunks that matched the original query.
 * @param index - The search index to look up related chunks.
 * @param maxDepth - Maximum import hops to follow (default: 2).
 * @returns Map of chunk ID → related search results.
 */
export function findRelatedChunks(
  matchedChunks: SearchResult[],
  index: SearchIndex,
  maxDepth = 2,
): Map<string, SearchResult[]> {
  const related = new Map<string, SearchResult[]>();
  const visitedFiles = new Set<string>();

  for (const chunk of matchedChunks) {
    const chunkId = `${chunk.filePath}:${chunk.startLine}`;
    const chunkRelated: SearchResult[] = [];

    followImports(chunk.filePath, index, chunkRelated, visitedFiles, 0, maxDepth);

    if (chunkRelated.length > 0) {
      related.set(chunkId, chunkRelated);
    }
  }

  return related;
}

/**
 * Recursively follow imports from a file to find related chunks.
 */
function followImports(
  filePath: string,
  index: SearchIndex,
  results: SearchResult[],
  visited: Set<string>,
  depth: number,
  maxDepth: number,
): void {
  if (depth >= maxDepth || visited.has(filePath)) return;
  visited.add(filePath);

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const imports = extractImports(filePath, content);

  for (const imp of imports) {
    if (!imp.resolvedPath || visited.has(imp.resolvedPath)) continue;

    const chunks = index.getChunksForFile(imp.resolvedPath);
    if (chunks.length === 0) continue;

    // If specific symbols were imported, only include matching chunks
    if (imp.symbols.length > 0) {
      for (const chunk of chunks) {
        if (imp.symbols.some((s) => chunk.name === s)) {
          results.push({
            filePath: chunk.filePath,
            name: chunk.name,
            kind: chunk.kind,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            score: 0.5 / (depth + 1), // Decay score with depth
          });
        }
      }
    } else {
      // Star/default import — include top-level exports
      for (const chunk of chunks.slice(0, 3)) {
        results.push({
          filePath: chunk.filePath,
          name: chunk.name,
          kind: chunk.kind,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: 0.3 / (depth + 1),
        });
      }
    }

    // Recurse
    followImports(imp.resolvedPath, index, results, visited, depth + 1, maxDepth);
  }
}
