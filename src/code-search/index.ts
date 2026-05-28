/**
 * Code search module — barrel exports.
 */

export { CodeSearchService } from './searcher.js';
export { SearchIndex, HybridIndex } from './indexer.js';
export { BM25Index } from './bm25-index.js';
export { VectorIndex } from './vector-index.js';
export { splitIntoChunks } from './chunker.js';
export { extractImports, findRelatedChunks } from './multi-hop.js';
export { reciprocalRankFusion, fuseSearchResults, explainRRFScore } from './hybrid-rrf.js';
export { LocalEmbedder, ApiEmbedder, createEmbedder } from './embedder.js';
export { InMemoryEmbeddingCache } from './cache.js';
export type {
  RRFOptions,
  RRFResult,
  FusedSearchResult,
} from './hybrid-rrf.js';
export type {
  CodeChunk,
  SearchResult,
  SearchOptions,
  IndexOptions,
  ChunkKind,
} from './types.js';
export type { Embedder } from './embedder.js';
export type { EmbeddingCache } from './cache.js';
