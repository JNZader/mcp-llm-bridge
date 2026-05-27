/**
 * Unified classification module — harmonizes task taxonomy
 * across bridge, local-llm, and model-routing subsystems.
 *
 * Subsumes both coarse bridge types and fine-grained local-llm
 * offload types into a single TaskType string union.
 */

/** Unified task type enum — subsumes bridge + local-llm taxonomies. */
export type TaskType =
  | 'large-context'
  | 'code-review'
  | 'fast-completion'
  | 'default'
  | 'boilerplate'
  | 'commit-message'
  | 'format-conversion'
  | 'style-check'
  | 'summarization'
  | 'translation'
  | 'not-offloadable';

/** Result of a unified classification. */
export interface ClassificationResult {
  /** Detected task type. */
  task: TaskType;
  /** Confidence score 0-1. */
  confidence: number;
  /** Whether this task should be offloaded to a local LLM. */
  shouldOffload?: boolean;
  /** Reason for the decision. */
  reason?: string;
}

/** Configuration for tuning heuristic thresholds. */
export interface ClassifierConfig {
  /** Token count threshold for large-context classification (default: 100_000). */
  largeContextThreshold: number;
  /** Max prompt length for fast-completion classification (default: 500). */
  fastCompletionMaxLength: number;
  /** Keywords that trigger code-review classification. */
  codeReviewKeywords: string[];
}

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
 * Keywords that indicate complex reasoning — NEVER offload these.
 * If any of these appear, the task stays with the primary model.
 */
const COMPLEX_TASK_KEYWORDS = [
  'architect',
  'design pattern',
  'security audit',
  'performance optimization',
  'debug',
  'investigate',
  'root cause',
  'explain why',
  'trade-off',
  'tradeoff',
  'refactor entire',
  'migration strategy',
  'code review',
  'pull request review',
  'vulnerability',
  'threat model',
];

/** Pattern definitions for each offloadable task type. */
interface TaskPattern {
  task: TaskType;
  keywords: string[];
  maxPromptLength: number;
  baseConfidence: number;
}

const TASK_PATTERNS: TaskPattern[] = [
  {
    task: 'commit-message',
    keywords: [
      'commit message', 'git commit', 'write a commit',
      'conventional commit', 'commit msg',
    ],
    maxPromptLength: 5000,
    baseConfidence: 0.95,
  },
  {
    task: 'boilerplate',
    keywords: [
      'boilerplate', 'scaffold', 'template', 'stub',
      'generate interface', 'create skeleton', 'type definition',
      'dto', 'data transfer object',
    ],
    maxPromptLength: 3000,
    baseConfidence: 0.85,
  },
  {
    task: 'format-conversion',
    keywords: [
      'convert to json', 'convert to yaml', 'convert to csv',
      'json to', 'yaml to', 'csv to', 'xml to',
      'format as', 'reformat', 'transform format',
    ],
    maxPromptLength: 10000,
    baseConfidence: 0.90,
  },
  {
    task: 'style-check',
    keywords: [
      'lint', 'style check', 'formatting', 'code style',
      'naming convention', 'eslint', 'prettier',
      'check syntax', 'validate format',
    ],
    maxPromptLength: 8000,
    baseConfidence: 0.80,
  },
  {
    task: 'summarization',
    keywords: [
      'summarize', 'summary', 'tldr', 'tl;dr',
      'brief overview', 'key points',
    ],
    maxPromptLength: 15000,
    baseConfidence: 0.75,
  },
  {
    task: 'translation',
    keywords: [
      'translate to', 'translate from', 'translation',
      'convert to english', 'convert to spanish',
    ],
    maxPromptLength: 10000,
    baseConfidence: 0.80,
  },
];

/**
 * Estimate token count from a string.
 *
 * Uses the ~4 chars per token heuristic (English text average).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Unified classify — heuristic-based prompt classification.
 *
 * Priority order (first match wins):
 * 1. Token count > threshold → 'large-context'
 * 2. Complex task markers → 'not-offloadable'
 * 3. Code review keywords → 'code-review'
 * 4. Local-LLM offloadable task patterns
 * 5. Short prompt (< maxLength) → 'fast-completion'
 * 6. No match → 'default'
 */
export function classify(
  prompt: string,
  config?: Partial<ClassifierConfig>,
): ClassificationResult {
  const cfg: ClassifierConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // 1. Large context — estimated token count exceeds threshold
  const tokens = estimateTokens(prompt);
  if (tokens > cfg.largeContextThreshold) {
    return {
      task: 'large-context',
      confidence: 0.99,
      shouldOffload: false,
      reason: `Estimated ${tokens} tokens exceeds ${cfg.largeContextThreshold} threshold`,
    };
  }

  const lower = prompt.toLowerCase();

  // 2. Complex task markers — immediate rejection (not-offloadable)
  const hasComplexMarker = COMPLEX_TASK_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasComplexMarker) {
    return {
      task: 'not-offloadable',
      confidence: 0.95,
      shouldOffload: false,
      reason: 'Complex reasoning task detected — requires primary model',
    };
  }

  // 3. Code review — prompt contains review-related keywords
  const hasCodeReviewKeyword = cfg.codeReviewKeywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  if (hasCodeReviewKeyword) {
    return {
      task: 'code-review',
      confidence: 0.90,
      shouldOffload: false,
      reason: 'Code review keyword detected',
    };
  }

  // 4. Score each offloadable task pattern
  let bestMatch: { pattern: TaskPattern; matchCount: number } | null = null;

  for (const pattern of TASK_PATTERNS) {
    const matchCount = pattern.keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount === 0) continue;

    // Reject if prompt exceeds max length for this task type
    if (prompt.length > pattern.maxPromptLength) continue;

    if (!bestMatch || matchCount > bestMatch.matchCount) {
      bestMatch = { pattern, matchCount };
    }
  }

  if (bestMatch) {
    const { pattern, matchCount } = bestMatch;
    const bonusPerMatch = 0.02;
    const confidence = Math.min(1.0, pattern.baseConfidence + (matchCount - 1) * bonusPerMatch);
    return {
      task: pattern.task,
      confidence,
      shouldOffload: true,
      reason: `Matched ${matchCount} keyword(s) for ${pattern.task}`,
    };
  }

  // 5. Fast completion — short prompts without special keywords
  if (prompt.length > 0 && prompt.length < cfg.fastCompletionMaxLength) {
    return {
      task: 'fast-completion',
      confidence: 0.70,
      shouldOffload: true,
      reason: `Short prompt (${prompt.length} chars < ${cfg.fastCompletionMaxLength})`,
    };
  }

  // 6. Default — no heuristic matched
  return {
    task: 'default',
    confidence: 0.50,
    shouldOffload: false,
    reason: 'No heuristic pattern matched',
  };
}
