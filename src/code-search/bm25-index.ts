/**
 * BM25 search index wrapper around MiniSearch.
 *
 * Provides keyword search with BM25 scoring, field boosting,
 * and fast retrieval for hybrid RRF fusion.
 */

import MiniSearch from 'minisearch';

/** Document shape expected by BM25Index. */
export interface BM25Document {
  id: string;
  name: string;
  content: string;
}

/** BM25 index backed by MiniSearch. */
export class BM25Index {
  private index: MiniSearch<BM25Document>;

  constructor() {
    this.index = new MiniSearch({
      fields: ['name', 'content'],
      storeFields: ['name'],
      searchOptions: {
        boost: { name: 2.0, content: 1.0 },
      },
    });
  }

  /** Add a document to the index. */
  add(doc: BM25Document): void {
    this.index.add(doc);
  }

  /**
   * Search the index and return ranked results.
   *
   * Results are sorted by descending BM25 score. The `limit` parameter
   * caps the number of returned items.
   */
  search(query: string, limit: number): Array<{ id: string; score: number; name?: string }> {
    if (!query.trim()) {
      return [];
    }

    const results = this.index.search(query);
    return results.slice(0, limit).map((r) => ({
      id: String(r.id),
      score: r.score,
      name: r.name,
    }));
  }

  /** Remove all documents from the index. */
  clear(): void {
    this.index.removeAll();
  }

  /** Number of documents in the index. */
  size(): number {
    return this.index.documentCount;
  }

  /** Whether MiniSearch is available (always true if imported). */
  isAvailable(): boolean {
    return true;
  }
}
