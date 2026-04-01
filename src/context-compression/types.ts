/**
 * Context Compression — type definitions.
 *
 * Defines the strategy interface, configuration, and options
 * for background context compression.
 */

/** Options passed to a compression strategy. */
export interface CompressionOptions {
  /** Target compression ratio (0-1). E.g., 0.5 = keep ~50% of content. */
  ratio?: number;
  /** Absolute character budget for the output. */
  maxChars?: number;
}

/** A pluggable compression strategy. */
export interface CompressionStrategy {
  /** Human-readable strategy name. */
  readonly name: string;
  /** Compress the given content according to the options. */
  compress(content: string, options?: CompressionOptions): string;
}

/** Configuration for the CompressorService. */
export interface CompressorConfig {
  /** Maximum number of entries in the LRU cache. Default: 200. */
  maxCacheSize?: number;
  /** Background worker tick interval in ms. Default: 5000. */
  workerIntervalMs?: number;
  /** Default strategy name when none specified. Default: 'extractive'. */
  defaultStrategy?: string;
  /** Default compression ratio. Default: 0.5. */
  defaultRatio?: number;
}

/** Default configuration values. */
export const DEFAULT_COMPRESSOR_CONFIG: Required<CompressorConfig> = {
  maxCacheSize: 200,
  workerIntervalMs: 5_000,
  defaultStrategy: 'extractive',
  defaultRatio: 0.5,
};

/** A queued item waiting for background compression. */
export interface CompressionQueueItem {
  content: string;
  strategy: string;
  options?: CompressionOptions;
}
