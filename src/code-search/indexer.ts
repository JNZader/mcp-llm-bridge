/**
 * In-memory search index with keyword + fuzzy matching.
 *
 * Uses an inverted index for fast keyword lookup and trigram
 * similarity for fuzzy matching. No external dependencies.
 */

import type { CodeChunk, SearchResult } from './types.js';
import { BM25Index } from './bm25-index.js';
import { VectorIndex } from './vector-index.js';
import type { Embedder } from './embedder.js';

/** Tokenize text into searchable tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Split a string into trigrams for fuzzy matching. */
function trigrams(text: string): Set<string> {
  const padded = `  ${text.toLowerCase()}  `;
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    grams.add(padded.substring(i, i + 3));
  }
  return grams;
}

/** Compute Jaccard similarity between two trigram sets. */
function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const g of a) {
    if (b.has(g)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Score type for ranking. */
interface ChunkScore {
  chunk: CodeChunk;
  score: number;
}

/**
 * In-memory search index for code chunks.
 *
 * Supports exact keyword matching and trigram-based fuzzy search.
 */
export class SearchIndex {
  /** All indexed chunks. */
  private chunks: CodeChunk[] = [];
  /** Inverted index: token → set of chunk indices. */
  private invertedIndex = new Map<string, Set<number>>();
  /** Pre-computed trigrams for each chunk's name. */
  private nameTrigrams: Array<{ idx: number; grams: Set<string>; name: string }> = [];

  /** Number of indexed chunks. */
  get size(): number {
    return this.chunks.length;
  }

  /** Clear the entire index. */
  clear(): void {
    this.chunks = [];
    this.invertedIndex.clear();
    this.nameTrigrams = [];
  }

  /**
   * Add chunks to the index.
   * Tokenizes names and content for keyword search,
   * and pre-computes trigrams for fuzzy matching.
   */
  addChunks(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      const idx = this.chunks.length;
      this.chunks.push(chunk);

      // Index by name tokens (higher weight)
      const nameTokens = tokenize(chunk.name);
      for (const token of nameTokens) {
        let set = this.invertedIndex.get(token);
        if (!set) {
          set = new Set();
          this.invertedIndex.set(token, set);
        }
        set.add(idx);
      }

      // Index by content tokens
      const contentTokens = tokenize(chunk.content);
      for (const token of contentTokens) {
        let set = this.invertedIndex.get(token);
        if (!set) {
          set = new Set();
          this.invertedIndex.set(token, set);
        }
        set.add(idx);
      }

      // Pre-compute name trigrams for fuzzy
      this.nameTrigrams.push({
        idx,
        grams: trigrams(chunk.name),
        name: chunk.name.toLowerCase(),
      });
    }
  }

  /**
   * Search the index with keyword + fuzzy matching.
   *
   * Scoring:
   * - Exact name match: 1.0
   * - Name prefix match: 0.8
   * - Keyword in content: 0.5 per token hit
   * - Fuzzy name match: similarity * 0.6
   *
   * @param query - Search query string.
   * @param limit - Max results to return.
   * @returns Ranked search results.
   */
  search(query: string, limit: number): SearchResult[] {
    if (this.chunks.length === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores = new Map<number, number>();
    const queryLower = query.toLowerCase().trim();
    const queryGrams = trigrams(queryLower);

    // 1. Exact + prefix name matching
    for (const { idx, name } of this.nameTrigrams) {
      if (name === queryLower) {
        scores.set(idx, (scores.get(idx) ?? 0) + 1.0);
      } else if (name.startsWith(queryLower) || queryLower.startsWith(name)) {
        scores.set(idx, (scores.get(idx) ?? 0) + 0.8);
      }
    }

    // 2. Keyword matching via inverted index
    for (const token of queryTokens) {
      const matching = this.invertedIndex.get(token);
      if (matching) {
        for (const idx of matching) {
          // Check if it's a name token match (higher score) or content
          const chunk = this.chunks[idx]!;
          const nameTokens = tokenize(chunk.name);
          const isNameMatch = nameTokens.includes(token);
          const bonus = isNameMatch ? 0.6 : 0.3;
          scores.set(idx, (scores.get(idx) ?? 0) + bonus);
        }
      }
    }

    // 3. Fuzzy name matching via trigrams
    for (const { idx, grams } of this.nameTrigrams) {
      const sim = trigramSimilarity(queryGrams, grams);
      if (sim > 0.3) {
        scores.set(idx, (scores.get(idx) ?? 0) + sim * 0.6);
      }
    }

    // Sort by score descending, take top N
    const ranked: ChunkScore[] = [];
    for (const [idx, score] of scores) {
      ranked.push({ chunk: this.chunks[idx]!, score });
    }
    ranked.sort((a, b) => b.score - a.score);

    // Normalize scores to 0-1 range
    const maxScore = ranked[0]?.score ?? 1;

    return ranked.slice(0, limit).map(({ chunk, score }) => ({
      filePath: chunk.filePath,
      name: chunk.name,
      kind: chunk.kind,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: Math.min(1, score / maxScore),
    }));
  }

  /** Get a chunk by its ID. */
  getChunk(id: string): CodeChunk | undefined {
    return this.chunks.find((c) => c.id === id);
  }

  /** Get all chunks for a specific file. */
  getChunksForFile(filePath: string): CodeChunk[] {
    return this.chunks.filter((c) => c.filePath === filePath);
  }
}

/**
 * Multi-index builder that populates keyword, BM25, and vector indices
 * from the same set of code chunks.
 *
 * Keyword index is always built. BM25 and vector indices are built when
 * the corresponding components are available (vector requires an Embedder).
 */
export class HybridIndex {
  /** Classic keyword + fuzzy index. Always present. */
  keywordIndex = new SearchIndex();
  /** BM25 keyword index (requires minisearch). */
  bm25Index = new BM25Index();
  /** Dense vector index for semantic search. */
  vectorIndex = new VectorIndex();

  constructor(private embedder?: Embedder) {}

  /** Number of chunks in the keyword index. */
  get size(): number {
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

  /** Whether vector (semantic) indexing is enabled. */
  get hasVectorIndex(): boolean {
    return this.vectorIndex.size() > 0;
  }

  /** Clear all sub-indices. */
  clear(): void {
    this.keywordIndex.clear();
    this.bm25Index.clear();
    this.vectorIndex.clear();
  }

  /**
   * Add chunks to all enabled indices.
   *
   * - Keyword index: always populated (synchronous).
   * - BM25 index: populated if minisearch is available (synchronous).
   * - Vector index: populated if an embedder was provided (asynchronous).
   */
  async addChunks(chunks: CodeChunk[]): Promise<void> {
    this.keywordIndex.addChunks(chunks);

    for (const chunk of chunks) {
      this.bm25Index.add({
        id: chunk.id,
        name: chunk.name,
        content: chunk.content,
      });

      if (this.embedder) {
        const vector = await this.embedder.embed(chunk.content);
        this.vectorIndex.add(chunk.id, vector);
      }
    }
  }

  /**
   * Search the keyword index.
   *
   * Thin wrapper around `keywordIndex.search()` for backward compatibility.
   */
  search(query: string, limit: number): SearchResult[] {
    return this.keywordIndex.search(query, limit);
  }

  /** Get a chunk by its ID from the keyword index. */
  getChunk(id: string): CodeChunk | undefined {
    return this.keywordIndex.getChunk(id);
  }

  /** Get all chunks for a specific file from the keyword index. */
  getChunksForFile(filePath: string): CodeChunk[] {
    return this.keywordIndex.getChunksForFile(filePath);
  }
}
