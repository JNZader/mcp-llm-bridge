/**
 * Local LLM task router — decide which tasks to offload.
 *
 * Classifies incoming prompts using heuristics to determine
 * if a task is safe to offload to a local LLM. Bounded,
 * deterministic tasks (boilerplate, commit msgs, format conversion)
 * get offloaded. Complex reasoning stays with Claude.
 */

import type { TaskClassification, OffloadTask } from './types.js';
import { OFFLOAD_TASK } from './types.js';

/**
 * Pattern definitions for each offloadable task type.
 * Each entry has keyword patterns and a max prompt length
 * beyond which we assume the task is too complex to offload.
 */
interface TaskPattern {
  task: OffloadTask;
  /** Keywords that suggest this task type (case-insensitive). */
  keywords: string[];
  /** Maximum prompt length in chars for this task type. */
  maxPromptLength: number;
  /** Base confidence when keywords match. */
  baseConfidence: number;
}

const TASK_PATTERNS: TaskPattern[] = [
  {
    task: OFFLOAD_TASK.COMMIT_MESSAGE,
    keywords: [
      'commit message', 'git commit', 'write a commit',
      'conventional commit', 'commit msg',
    ],
    maxPromptLength: 5000,
    baseConfidence: 0.95,
  },
  {
    task: OFFLOAD_TASK.BOILERPLATE,
    keywords: [
      'boilerplate', 'scaffold', 'template', 'stub',
      'generate interface', 'create skeleton', 'type definition',
      'dto', 'data transfer object',
    ],
    maxPromptLength: 3000,
    baseConfidence: 0.85,
  },
  {
    task: OFFLOAD_TASK.FORMAT_CONVERSION,
    keywords: [
      'convert to json', 'convert to yaml', 'convert to csv',
      'json to', 'yaml to', 'csv to', 'xml to',
      'format as', 'reformat', 'transform format',
    ],
    maxPromptLength: 10000,
    baseConfidence: 0.90,
  },
  {
    task: OFFLOAD_TASK.STYLE_CHECK,
    keywords: [
      'lint', 'style check', 'formatting', 'code style',
      'naming convention', 'eslint', 'prettier',
      'check syntax', 'validate format',
    ],
    maxPromptLength: 8000,
    baseConfidence: 0.80,
  },
  {
    task: OFFLOAD_TASK.SUMMARIZATION,
    keywords: [
      'summarize', 'summary', 'tldr', 'tl;dr',
      'brief overview', 'key points',
    ],
    maxPromptLength: 15000,
    baseConfidence: 0.75,
  },
  {
    task: OFFLOAD_TASK.TRANSLATION,
    keywords: [
      'translate to', 'translate from', 'translation',
      'convert to english', 'convert to spanish',
    ],
    maxPromptLength: 10000,
    baseConfidence: 0.80,
  },
];

/**
 * Keywords that indicate complex reasoning — NEVER offload these.
 * If any of these appear, the task stays with the primary model.
 */
const COMPLEX_TASK_KEYWORDS = [
  'architect', 'design pattern', 'security audit',
  'performance optimization', 'debug', 'investigate',
  'root cause', 'explain why', 'trade-off', 'tradeoff',
  'refactor entire', 'migration strategy', 'code review',
  'pull request review', 'vulnerability', 'threat model',
];

/**
 * Classify a prompt for local LLM offloading.
 *
 * Returns the task type, confidence score, and whether
 * the task should be offloaded. Uses heuristic keyword
 * matching — NO LLM inference for classification.
 */
export function classifyForOffload(prompt: string): TaskClassification {
  const lower = prompt.toLowerCase();

  // 1. Check for complex task markers — immediate rejection
  const hasComplexMarker = COMPLEX_TASK_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasComplexMarker) {
    return {
      task: OFFLOAD_TASK.NOT_OFFLOADABLE,
      confidence: 0.95,
      shouldOffload: false,
      reason: 'Complex reasoning task detected — requires primary model',
    };
  }

  // 2. Score each task pattern
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

  if (!bestMatch) {
    return {
      task: OFFLOAD_TASK.NOT_OFFLOADABLE,
      confidence: 0.6,
      shouldOffload: false,
      reason: 'No offloadable task pattern matched',
    };
  }

  // 3. Compute confidence: base + bonus for multiple keyword matches
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

/**
 * Check if a task classification meets the minimum confidence for offloading.
 */
export function meetsOffloadThreshold(
  classification: TaskClassification,
  minConfidence: number,
): boolean {
  return classification.shouldOffload && classification.confidence >= minConfidence;
}
