/**
 * Context Compression — strategy implementations.
 *
 * Three strategies for compressing context:
 * - Extractive: keep key sentences based on scoring
 * - Structural: keep headings + first lines of sections
 * - TokenBudget: truncate to fit a character budget
 */

import type { CompressionStrategy, CompressionOptions } from './types.js';

/**
 * Score a sentence by simple heuristics:
 * - Longer sentences score higher (more information)
 * - Sentences with keywords score higher
 * - First/last sentences of the input score higher (positional importance)
 */
function scoreSentence(sentence: string, index: number, total: number): number {
  let score = 0;

  // Length bonus (normalized)
  score += Math.min(sentence.length / 100, 1);

  // Positional bonus — first and last sentences are more important
  if (index === 0 || index === total - 1) {
    score += 1.5;
  } else if (index < 3) {
    score += 0.5;
  }

  // Keyword bonus — sentences with important markers
  const keywords = /\b(must|should|important|key|critical|note|requires|error|warning|always|never)\b/i;
  if (keywords.test(sentence)) {
    score += 1;
  }

  return score;
}

/**
 * Split text into sentences using a simple regex.
 * Handles common abbreviations poorly (acceptable for compression, not NLP).
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extractive compression — keeps the highest-scoring sentences
 * from the original text, preserving their order.
 */
export class ExtractiveStrategy implements CompressionStrategy {
  readonly name = 'extractive';

  compress(content: string, options?: CompressionOptions): string {
    if (!content) return '';

    const ratio = options?.ratio ?? 0.5;
    const sentences = splitSentences(content);

    if (sentences.length <= 1) return content;

    const keepCount = Math.max(1, Math.ceil(sentences.length * ratio));

    // Score each sentence
    const scored = sentences.map((s, i) => ({
      sentence: s,
      index: i,
      score: scoreSentence(s, i, sentences.length),
    }));

    // Sort by score descending, take top N
    const selected = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, keepCount)
      // Re-sort by original position to maintain reading order
      .sort((a, b) => a.index - b.index);

    return selected.map((s) => s.sentence).join(' ');
  }
}

/**
 * Structural compression — keeps markdown headings and
 * the first line of each section.
 */
export class StructuralStrategy implements CompressionStrategy {
  readonly name = 'structural';

  compress(content: string, _options?: CompressionOptions): string {
    if (!content) return '';

    const lines = content.split('\n');
    const result: string[] = [];
    let lastWasHeading = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Keep all headings
      if (/^#{1,6}\s/.test(trimmed)) {
        result.push(line);
        lastWasHeading = true;
        continue;
      }

      // Keep first non-empty line after a heading
      if (lastWasHeading && trimmed.length > 0) {
        result.push(line);
        lastWasHeading = false;
        continue;
      }

      // Keep list items (bullet points carry structure)
      if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        result.push(line);
        continue;
      }

      lastWasHeading = false;
    }

    // If no structural elements found, fall back to first few lines
    if (result.length === 0) {
      return lines.slice(0, Math.max(1, Math.ceil(lines.length * 0.3))).join('\n');
    }

    return result.join('\n');
  }
}

/**
 * Token-budget compression — truncates content to fit
 * within a character budget, preferring to break at sentence
 * boundaries when possible.
 */
export class TokenBudgetStrategy implements CompressionStrategy {
  readonly name = 'token-budget';

  compress(content: string, options?: CompressionOptions): string {
    if (!content) return '';

    const maxChars = options?.maxChars ?? Math.ceil(content.length * (options?.ratio ?? 0.5));

    if (content.length <= maxChars) return content;

    // Try to break at a sentence boundary
    const sentences = splitSentences(content);
    let result = '';

    for (const sentence of sentences) {
      const next = result ? `${result} ${sentence}` : sentence;
      if (next.length > maxChars) break;
      result = next;
    }

    // If even the first sentence exceeds budget, hard-truncate
    if (!result) {
      return content.slice(0, maxChars);
    }

    return result;
  }
}

/** Registry of all built-in strategies. */
export const STRATEGIES: Record<string, CompressionStrategy> = {
  extractive: new ExtractiveStrategy(),
  structural: new StructuralStrategy(),
  'token-budget': new TokenBudgetStrategy(),
};

/**
 * Get a strategy by name.
 * @throws if the strategy name is not recognized.
 */
export function getStrategy(name: string): CompressionStrategy {
  const strategy = STRATEGIES[name];
  if (!strategy) {
    throw new Error(`Unknown compression strategy: "${name}". Available: ${Object.keys(STRATEGIES).join(', ')}`);
  }
  return strategy;
}
