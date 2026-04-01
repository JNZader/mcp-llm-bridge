/**
 * Code search service — orchestrates chunking, indexing, and search.
 *
 * Provides the main API for the code_search and index_codebase MCP tools.
 * Manages the in-memory index lifecycle.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { splitIntoChunks } from './chunker.js';
import { SearchIndex } from './indexer.js';
import { findRelatedChunks } from './multi-hop.js';
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './types.js';
import type { SearchOptions, SearchResult, IndexOptions } from './types.js';
import { logger } from '../core/logger.js';

/**
 * Main code search service.
 *
 * Scans directories, chunks files, builds an in-memory search index,
 * and provides keyword + fuzzy search with optional multi-hop.
 */
export class CodeSearchService {
  private index = new SearchIndex();
  private indexedScopes = new Map<string, number>(); // scope → timestamp

  /** Get the current index size (number of chunks). */
  get indexSize(): number {
    return this.index.size;
  }

  /**
   * Index a codebase directory.
   *
   * Scans all matching files, chunks them, and builds the search index.
   * If the scope was already indexed within the last 5 minutes, skips re-indexing.
   *
   * @param opts - Indexing options.
   * @returns Number of chunks indexed.
   */
  indexDirectory(opts: IndexOptions): number {
    const {
      rootDir,
      ignorePatterns = DEFAULT_IGNORE,
      maxFileSize = DEFAULT_MAX_FILE_SIZE,
      extensions = DEFAULT_EXTENSIONS,
    } = opts;

    // Check if recently indexed (5 min TTL)
    const lastIndexed = this.indexedScopes.get(rootDir);
    if (lastIndexed && Date.now() - lastIndexed < 5 * 60 * 1000) {
      logger.debug({ rootDir }, 'Scope recently indexed, skipping');
      return this.index.size;
    }

    logger.info({ rootDir }, 'Indexing codebase');

    const ignoreSet = new Set(ignorePatterns);
    const extSet = new Set(extensions);
    const files = this.collectFiles(rootDir, ignoreSet, extSet, maxFileSize);

    // Clear previous index for this scope
    this.index.clear();

    let totalChunks = 0;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const relPath = relative(rootDir, filePath);
        const chunks = splitIntoChunks(relPath, content);
        this.index.addChunks(chunks);
        totalChunks += chunks.length;
      } catch (err) {
        logger.warn({ filePath, error: err }, 'Failed to chunk file');
      }
    }

    this.indexedScopes.set(rootDir, Date.now());
    logger.info({ rootDir, files: files.length, chunks: totalChunks }, 'Indexing complete');

    return totalChunks;
  }

  /**
   * Search the indexed codebase.
   *
   * If no index exists for the scope, indexes it first.
   *
   * @param opts - Search options.
   * @returns Ranked search results.
   */
  search(opts: SearchOptions): SearchResult[] {
    const { query, scope, followImports = false } = opts;
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    if (!query.trim()) {
      return [];
    }

    // Auto-index if needed
    if (scope && this.index.size === 0) {
      this.indexDirectory({ rootDir: scope });
    }

    // Search
    const results = this.index.search(query, limit);

    // Multi-hop if requested
    if (followImports && results.length > 0) {
      const relatedMap = findRelatedChunks(results, this.index);
      for (const result of results) {
        const key = `${result.filePath}:${result.startLine}`;
        const related = relatedMap.get(key);
        if (related && related.length > 0) {
          result.related = related;
        }
      }
    }

    return results;
  }

  /**
   * Force re-index of a scope, ignoring the TTL cache.
   */
  reindex(rootDir: string): number {
    this.indexedScopes.delete(rootDir);
    return this.indexDirectory({ rootDir });
  }

  /**
   * Recursively collect files matching the criteria.
   */
  private collectFiles(
    dir: string,
    ignoreSet: Set<string>,
    extSet: Set<string>,
    maxFileSize: number,
  ): string[] {
    const files: string[] = [];

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoreSet.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...this.collectFiles(fullPath, ignoreSet, extSet, maxFileSize));
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (!extSet.has(ext)) continue;

          try {
            const stat = statSync(fullPath);
            if (stat.size > maxFileSize) continue;
            files.push(fullPath);
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return files;
  }
}
