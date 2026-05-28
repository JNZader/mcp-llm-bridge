/**
 * Flat vector index with cosine similarity search.
 *
 * Brute-force nearest-neighbour over an in-memory map of vectors.
 * Scores are cosine similarity normalized to [0,1] for RRF compatibility.
 */

export interface VectorIndexEntry {
  id: string;
  vector: Float32Array;
}

export class VectorIndex {
  private vectors: Map<string, Float32Array> = new Map();

  add(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  query(queryVector: Float32Array, topK: number): Array<{ id: string; score: number }> {
    if (this.vectors.size === 0 || topK <= 0) {
      return [];
    }

    const results: Array<{ id: string; score: number }> = [];
    const queryNorm = this.computeNorm(queryVector);

    for (const [id, vector] of this.vectors) {
      let score: number;

      if (queryNorm === 0) {
        score = 0;
      } else {
        const vectorNorm = this.computeNorm(vector);
        if (vectorNorm === 0) {
          score = 0;
        } else {
          const dot = this.computeDotProduct(queryVector, vector);
          const cosine = dot / (queryNorm * vectorNorm);
          // Normalize from [-1, 1] to [0, 1]
          score = Math.max(0, Math.min(1, (cosine + 1) / 2));
        }
      }

      results.push({ id, score });
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    });
    return results.slice(0, topK);
  }

  clear(): void {
    this.vectors.clear();
  }

  size(): number {
    return this.vectors.size;
  }

  private computeDotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      sum += a[i]! * b[i]!;
    }
    return sum;
  }

  private computeNorm(v: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      const val = v[i]!;
      sum += val * val;
    }
    return Math.sqrt(sum);
  }
}
