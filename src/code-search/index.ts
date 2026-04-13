/**
 * Code search module — barrel exports.
 */

export { CodeSearchService } from './searcher.js';
export { SearchIndex } from './indexer.js';
export { splitIntoChunks } from './chunker.js';
export { extractImports, findRelatedChunks } from './multi-hop.js';
export { reciprocalRankFusion, fuseSearchResults, explainRRFScore } from './hybrid-rrf.js';
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
