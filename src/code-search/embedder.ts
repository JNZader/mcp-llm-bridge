/**
 * Embedder abstraction for code-search.
 *
 * Provides local (Xenova/all-MiniLM-L6-v2) and remote (OpenAI)
 * embedding strategies with automatic fallback.
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import OpenAI from 'openai';
import { logger } from '../core/logger.js';

/** Something that can turn a string into a dense vector. */
export interface Embedder {
  embed(text: string): Promise<Float32Array>;
}

/** Local transformer-based embedder (lazy singleton). */
export class LocalEmbedder implements Embedder {
  private static instance: LocalEmbedder | null = null;
  private model: FeatureExtractionPipeline | null = null;
  private loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

  private constructor() {}

  static getInstance(): LocalEmbedder {
    if (!LocalEmbedder.instance) {
      LocalEmbedder.instance = new LocalEmbedder();
    }
    return LocalEmbedder.instance;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.model) {
      if (!this.loadingPromise) {
        this.loadingPromise = this.loadModel();
      }
      this.model = await this.loadingPromise;
    }

    const output = await this.model(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data as Float32Array);
  }

  private async loadModel(): Promise<FeatureExtractionPipeline> {
    logger.info({ model: 'Xenova/all-MiniLM-L6-v2' }, 'Loading local embedding model…');
    const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: false,
    });
    logger.info({ model: 'Xenova/all-MiniLM-L6-v2' }, 'Local embedding model loaded');
    return model;
  }
}

/** OpenAI API embedder (text-embedding-3-small). */
export class ApiEmbedder implements Embedder {
  private client: OpenAI;

  constructor(apiKey?: string, client?: OpenAI) {
    if (client) {
      this.client = client;
    } else {
      const key = apiKey ?? process.env['OPENAI_API_KEY'];
      if (!key) {
        throw new Error('OPENAI_API_KEY is required for ApiEmbedder');
      }
      this.client = new OpenAI({ apiKey: key });
    }
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('OpenAI returned empty embedding');
    }

    return new Float32Array(embedding);
  }
}

/** Create the best available embedder with automatic fallback. */
export async function createEmbedder(
  preferLocal = true,
  deps?: { local?: Embedder; api?: Embedder },
): Promise<Embedder> {
  if (preferLocal) {
    try {
      const local = deps?.local ?? LocalEmbedder.getInstance();
      await local.embed('test');
      return local;
    } catch (err) {
      logger.warn({ err }, 'Local embedder failed to load, falling back to OpenAI API');
    }
  }

  try {
    const api = deps?.api ?? new ApiEmbedder();
    // When an explicit api dep is provided (tests / wrappers), verify it works.
    if (deps?.api) {
      await api.embed('test');
    }
    return api;
  } catch (err) {
    logger.error({ err }, 'API embedder also failed to initialize');
    throw new Error('No embedder available: local model failed and OPENAI_API_KEY is missing');
  }
}
