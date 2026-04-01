/**
 * Code search module — barrel exports.
 */

export { CodeSearchService } from './searcher.js';
export { SearchIndex } from './indexer.js';
export { splitIntoChunks } from './chunker.js';
export { extractImports, findRelatedChunks } from './multi-hop.js';
export type {
  CodeChunk,
  SearchResult,
  SearchOptions,
  IndexOptions,
  ChunkKind,
} from './types.js';
