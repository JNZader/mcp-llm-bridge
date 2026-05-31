import type { TaskClassification } from './types.js';
import { classify, type TaskType } from '../classification/index.js';

const LOCAL_OFFLOAD_SAFE_TASKS = new Set<TaskType>([
  'commit-message',
  'boilerplate',
  'format-conversion',
  'style-check',
  'summarization',
  'translation',
]);

const LOCAL_BLOCKED_TASKS = new Set<TaskType>([
  'large-context',
  'code-review',
  'fast-completion',
  'default',
  'not-offloadable',
]);

/**
 * Classify a prompt for local LLM offloading.
 *
 * Returns the task type, confidence score, and whether
 * the task should be offloaded. The local router delegates
 * detection to the unified classifier, then applies an
 * explicit local-safe allowlist.
 */
export function classifyForOffload(prompt: string): TaskClassification {
  const result = classify(prompt);

  if (LOCAL_OFFLOAD_SAFE_TASKS.has(result.task)) {
    return {
      task: result.task,
      confidence: result.confidence,
      shouldOffload: true,
      reason: result.reason ?? `Unified classifier matched ${result.task}`,
    };
  }

  if (LOCAL_BLOCKED_TASKS.has(result.task)) {
    return {
      task: result.task,
      confidence: result.confidence,
      shouldOffload: false,
      reason: result.reason ?? `Task type ${result.task} is not local-offloadable`,
    };
  }

  return {
    task: result.task,
    confidence: result.confidence,
    shouldOffload: false,
    reason: result.reason ?? 'Task is not local-offloadable',
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
