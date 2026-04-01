/**
 * Task classifier — heuristic-based prompt classification.
 *
 * Classifies incoming prompts into task types using simple
 * heuristics: token count estimation, keyword matching, and
 * prompt length. NO LLM-based classification (that would be
 * recursive and defeat the purpose).
 */

import type { TaskType, ClassifierConfig } from './types.js';

/** Default keywords that indicate code review tasks. */
const DEFAULT_CODE_REVIEW_KEYWORDS = [
  'review',
  'audit',
  'analyze',
  'refactor',
  'code quality',
  'security review',
  'pull request',
  'pr review',
  'code review',
  'inspect',
];

/** Default classifier configuration. */
const DEFAULT_CONFIG: ClassifierConfig = {
  largeContextThreshold: 100_000,
  fastCompletionMaxLength: 500,
  codeReviewKeywords: DEFAULT_CODE_REVIEW_KEYWORDS,
};

/**
 * Estimate token count from a string.
 *
 * Uses the ~4 chars per token heuristic (English text average).
 * Good enough for routing decisions — we don't need precision here.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Classify a prompt into a task type using heuristics.
 *
 * Priority order (first match wins):
 * 1. Token count > threshold → 'large-context'
 * 2. Contains code review keywords → 'code-review'
 * 3. Short prompt (< maxLength) → 'fast-completion'
 * 4. No match → 'default'
 */
export function classify(prompt: string, config?: Partial<ClassifierConfig>): TaskType {
  const cfg: ClassifierConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // 1. Large context — estimated token count exceeds threshold
  const tokens = estimateTokens(prompt);
  if (tokens > cfg.largeContextThreshold) {
    return 'large-context';
  }

  // 2. Code review — prompt contains review-related keywords
  const lowerPrompt = prompt.toLowerCase();
  const hasCodeReviewKeyword = cfg.codeReviewKeywords.some((keyword) =>
    lowerPrompt.includes(keyword.toLowerCase()),
  );
  if (hasCodeReviewKeyword) {
    return 'code-review';
  }

  // 3. Fast completion — short prompts without special keywords
  if (prompt.length < cfg.fastCompletionMaxLength) {
    return 'fast-completion';
  }

  // 4. Default — no heuristic matched
  return 'default';
}
