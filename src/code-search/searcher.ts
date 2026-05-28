/**
 * Code search service — orchestrates chunking, indexing, and search.
 *
 * Provides the main API for the code_search and index_codebase MCP tools.
 * Manages the in-memory index lifecycle.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { splitIntoChunks } from './chunker.js';
import { SearchIndex, HybridIndex } from './indexer.js';
import { findRelatedChunks } from './multi-hop.js';
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './types.js';
import type { SearchOptions, SearchResult, IndexOptions } from './types.js';
import type { Embedder } from './embedder.js';
import { logger } from '../core/logger.js';
import { fuseSearchResults } from './hybrid-rrf.js';

/**
 * Main code search service.
 *
 * Scans directories, chunks files, builds an in-memory search index,
 * and provides keyword + fuzzy search with optional multi-hop.
 *
 * Supports keyword (always), BM25, and vector indices with mode dispatch.
 */
export class CodeSearchService {
  private keywordIndex = new SearchIndex();
  /** BM25 keyword index (populated during indexing). */
  bm25Index = new HybridIndex().bm25Index;
  /** Dense vector index (populated when an embedder is provided). */
  vectorIndex = new HybridIndex().vectorIndex;
  private embedder?: Embedder;
  private indexedScopes = new Map<string, number>(); // scope → timestamp

  /**
   * @param opts.embedder - Optional embedder for semantic vector indexing.
   *                      When omitted, only keyword + BM25 indices are built.
   */
  constructor(opts?: { embedder?: Embedder }) {
    this.embedder = opts?.embedder;
  }

  /** Get the current keyword index size (number of chunks). */
  get indexSize(): number {
    return this.keywordIndex.size;
  }

  /** Sizes of each sub-index. */
  get indexSizes(): { keyword: number; bm25: number; vector: number } {
    return {
      keyword: this.keywordIndex.size,
      bm25: this.bm25Index.size(),
      vector: this.vectorIndex.size(),
    };
  }

  /**
   * Index a codebase directory.
   *
   * Scans all matching files, chunks them, and builds all enabled indices.
   * If the scope was already indexed within the last 5 minutes, skips re-indexing.
   *
   * @param opts - Indexing options.
   * @returns Number of chunks indexed.
   */
  async indexDirectory(opts: IndexOptions): Promise<number> {
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
      return this.keywordIndex.size;
    }

    logger.info({ rootDir }, 'Indexing codebase');

    const ignoreSet = new Set(ignorePatterns);
    const extSet = new Set(extensions);
    const files = this.collectFiles(rootDir, ignoreSet, extSet, maxFileSize);

    // Clear previous indices for this scope
    this.keywordIndex.clear();
    this.bm25Index.clear();
    this.vectorIndex.clear();

    let totalChunks = 0;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const relPath = relative(rootDir, filePath);
        const chunks = splitIntoChunks(relPath, content);

        // 1. Keyword index (always)
        this.keywordIndex.addChunks(chunks);

        for (const chunk of chunks) {
          // 2. BM25 index (always, gracefully degrades if minisearch missing)
          this.bm25Index.add({
            id: chunk.id,
            name: chunk.name,
            content: chunk.content,
          });

          // 3. Vector index (only when embedder available)
          if (this.embedder) {
            const vector = await this.embedder.embed(chunk.content);
            this.vectorIndex.add(chunk.id, vector);
          }
        }

        totalChunks += chunks.length;
      } catch (err) {
        logger.warn({ filePath, error: err }, 'Failed to chunk file');
      }
    }

    this.indexedScopes.set(rootDir, Date.now());
    logger.info(
      { rootDir, files: files.length, chunks: totalChunks, vector: this.vectorIndex.size() },
      'Indexing complete',
    );

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
  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const { query, scope, followImports = false, mode = 'keyword' } = opts;
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    if (!query.trim()) {
      return [];
    }

    // Auto-index if needed
    if (scope && this.keywordIndex.size === 0) {
      await this.indexDirectory({ rootDir: scope });
    }

    let results: SearchResult[] = [];

    switch (mode) {
      case 'vector':
        results = await this.vectorSearch(query, limit);
        break;
      case 'hybrid':
        results = await this.hybridSearch(query, limit);
        break;
      case 'keyword':
      default:
        results = this.keywordIndex.search(query, limit);
        break;
    }

    // Multi-hop if requested
    if (followImports && results.length > 0) {
      const relatedMap = findRelatedChunks(results, this.keywordIndex);
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
   * Vector-only search: embed query and search the vector index.
   */
  private async vectorSearch(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.embedder || this.vectorIndex.size() === 0) {
      return [];
    }

    const queryVector = await this.embedder.embed(query);
    const rawResults = this.vectorIndex.query(queryVector, limit).filter((r) => r.score > 0);
    return this.rawToSearchResults(rawResults);
  }

  /**
   * Hybrid search: fuse keyword, BM25, and vector results via RRF.
   */
  private async hybridSearch(query: string, limit: number): Promise<SearchResult[]> {
    // 1. Keyword search
    const keywordResults = this.keywordIndex.search(query, limit);

    // 2. BM25 search
    const rawBm25 = this.bm25Index.search(query, limit);
    const bm25Results = this.bm25ToSearchResults(rawBm25);

    // 3. Vector search
    let vectorResults: SearchResult[] = [];
    if (this.embedder && this.vectorIndex.size() > 0) {
      const queryVector = await this.embedder.embed(query);
      const rawVector = this.vectorIndex.query(queryVector, limit).filter((r) => r.score > 0);
      vectorResults = this.rawToSearchResults(rawVector);
    }

    // Build lists for RRF (filter out empty ones)
    const lists: SearchResult[][] = [];
    if (keywordResults.length > 0) lists.push(keywordResults);
    if (bm25Results.length > 0) lists.push(bm25Results);
    if (vectorResults.length > 0) lists.push(vectorResults);

    if (lists.length === 0) {
      return [];
    }

    if (lists.length === 1) {
      return lists[0]!;
    }

    return fuseSearchResults(lists, { limit });
  }

  /**
   * Convert raw {id, score} results to SearchResult by looking up chunks.
   */
  private rawToSearchResults(raw: Array<{ id: string; score: number }>): SearchResult[] {
    const results: SearchResult[] = [];
    for (const item of raw) {
      const chunk = this.keywordIndex.getChunk(item.id);
      if (!chunk) continue;
      results.push({
        filePath: chunk.filePath,
        name: chunk.name,
        kind: chunk.kind,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: item.score,
      });
    }
    return results;
  }

  /**
   * Convert BM25 raw results to SearchResult by looking up chunks.
   */
  private bm25ToSearchResults(raw: Array<{ id: string; score: number; name?: string }>): SearchResult[] {
    const results: SearchResult[] = [];
    for (const item of raw) {
      const chunk = this.keywordIndex.getChunk(item.id);
      if (!chunk) continue;
      results.push({
        filePath: chunk.filePath,
        name: chunk.name,
        kind: chunk.kind,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: item.score,
      });
    }
    return results;
  }

  /**
   * Force re-index of a scope, ignoring the TTL cache.
   */
  async reindex(rootDir: string): Promise<number> {
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
