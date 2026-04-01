/**
 * Types for the semantic code search module.
 *
 * Defines chunks, search results, and configuration for
 * the in-memory code search index.
 */

/** Kind of code chunk extracted from a source file. */
export type ChunkKind = 'function' | 'class' | 'interface' | 'block' | 'import' | 'type' | 'method';

/** A meaningful code chunk extracted from a source file. */
export interface CodeChunk {
  /** Unique identifier: `filePath:startLine` */
  id: string;
  /** Absolute or relative file path. */
  filePath: string;
  /** Name of the symbol (function name, class name, etc.). */
  name: string;
  /** Kind of chunk. */
  kind: ChunkKind;
  /** Raw source code content. */
  content: string;
  /** 1-based start line in the original file. */
  startLine: number;
  /** 1-based end line in the original file. */
  endLine: number;
}

/** A search result with relevance score. */
export interface SearchResult {
  /** The matched chunk. */
  filePath: string;
  name: string;
  kind: ChunkKind;
  content: string;
  startLine: number;
  endLine: number;
  /** Relevance score (0-1). */
  score: number;
  /** Related chunks from multi-hop import following. */
  related?: SearchResult[];
}

/** Options for the code_search MCP tool. */
export interface SearchOptions {
  /** Search query string. */
  query: string;
  /** Directory scope to limit search (default: project root). */
  scope?: string;
  /** Max results to return (default: 10, max: 50). */
  limit?: number;
  /** Follow imports to find related chunks (default: false). */
  followImports?: boolean;
}

/** Options for indexing a codebase. */
export interface IndexOptions {
  /** Root directory to index. */
  rootDir: string;
  /** Glob patterns to ignore (e.g. node_modules, .git). */
  ignorePatterns?: string[];
  /** Max file size in bytes to index (default: 100KB). */
  maxFileSize?: number;
  /** File extensions to index (default: common code extensions). */
  extensions?: string[];
}

/** Default file extensions to index. */
export const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.lua',
];

/** Default ignore patterns. */
export const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', 'target',
  '__pycache__', '.next', 'coverage', '.nyc_output',
  'vendor', '.cache',
];

/** Default max file size: 100KB. */
export const DEFAULT_MAX_FILE_SIZE = 100_000;

/** Default result limit. */
export const DEFAULT_LIMIT = 10;

/** Max result limit. */
export const MAX_LIMIT = 50;
