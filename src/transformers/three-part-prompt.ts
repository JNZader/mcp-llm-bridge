/**
 * Three-part prompt pattern — system/context/instruction separation.
 *
 * Splits prompts into three distinct parts for improved LLM comprehension:
 *   1. System — role, personality, constraints (stable across turns)
 *   2. Context — background info, data, documents (changes per request)
 *   3. Instruction — the actual task/question (user's intent)
 *
 * Inspired by houtini-ai/houtini-lm research showing measurable quality
 * improvement from separating these concerns, especially with smaller models.
 *
 * This module provides:
 * - A splitter that decomposes a flat prompt into three parts
 * - A composer that merges three parts into InternalMessage[] format
 * - An optimizer that applies the pattern to existing message arrays
 */

import type { InternalMessage } from '../core/internal-model.js';

// ── Types ──────────────────────────────────────────────────────

export interface ThreePartPrompt {
  /** Role definition, personality, constraints. */
  system: string;
  /** Background information, documents, data. */
  context: string;
  /** The actual task or question. */
  instruction: string;
}

export interface ThreePartOptions {
  /** Custom context markers. Default: common patterns like "Context:", "Background:", etc. */
  contextMarkers?: string[];
  /** Custom instruction markers. Default: "Task:", "Question:", "Do:", etc. */
  instructionMarkers?: string[];
  /** Separator to insert between parts when composing. Default: double newline. */
  separator?: string;
  /** Whether to add explicit section labels in composed output. Default: true. */
  addLabels?: boolean;
}

const DEFAULT_CONTEXT_MARKERS = [
  'context:', 'background:', 'given:', 'information:',
  'data:', 'document:', 'reference:', 'here is',
  'the following', 'based on',
];

const DEFAULT_INSTRUCTION_MARKERS = [
  'task:', 'question:', 'do:', 'please', 'instruction:',
  'generate', 'create', 'write', 'explain', 'analyze',
  'summarize', 'translate', 'list', 'find', 'compare',
  'what', 'how', 'why', 'when', 'where', 'who',
  'can you', 'could you', 'would you', 'i need',
];

// ── Splitter ───────────────────────────────────────────────────

/**
 * Split a flat prompt into three parts using heuristic detection.
 *
 * Strategy:
 * - Lines starting with system-like markers → system
 * - Lines starting with context markers → context
 * - Lines starting with instruction markers → instruction
 * - If no clear markers, uses position: first paragraph = context, last = instruction
 *
 * @param prompt - The flat prompt text.
 * @param options - Customization options.
 * @returns Three-part prompt structure.
 */
export function splitPrompt(prompt: string, options?: ThreePartOptions): ThreePartPrompt {
  const contextMarkers = options?.contextMarkers ?? DEFAULT_CONTEXT_MARKERS;
  const instructionMarkers = options?.instructionMarkers ?? DEFAULT_INSTRUCTION_MARKERS;

  const paragraphs = prompt.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return { system: '', context: '', instruction: '' };
  }

  if (paragraphs.length === 1) {
    return { system: '', context: '', instruction: paragraphs[0]! };
  }

  const system: string[] = [];
  const context: string[] = [];
  const instruction: string[] = [];

  for (const para of paragraphs) {
    const lowerPara = para.toLowerCase();

    // Check for system-like content (role definitions, constraints)
    if (
      lowerPara.startsWith('you are') ||
      lowerPara.startsWith('act as') ||
      lowerPara.startsWith('role:') ||
      lowerPara.startsWith('system:') ||
      lowerPara.startsWith('persona:') ||
      lowerPara.startsWith('rules:') ||
      lowerPara.startsWith('constraints:')
    ) {
      system.push(para);
      continue;
    }

    // Check for context markers
    const isContext = contextMarkers.some((marker) => lowerPara.startsWith(marker));
    if (isContext) {
      context.push(para);
      continue;
    }

    // Check for instruction markers
    const isInstruction = instructionMarkers.some((marker) => lowerPara.startsWith(marker));
    if (isInstruction) {
      instruction.push(para);
      continue;
    }

    // Fallback: shorter paragraphs with question marks are instructions
    if (para.includes('?') && para.length < 200) {
      instruction.push(para);
    } else {
      // Default: treat as context
      context.push(para);
    }
  }

  // If nothing ended up as instruction, move the last context to instruction
  if (instruction.length === 0 && context.length > 0) {
    instruction.push(context.pop()!);
  }

  return {
    system: system.join('\n\n'),
    context: context.join('\n\n'),
    instruction: instruction.join('\n\n'),
  };
}

// ── Composer ───────────────────────────────────────────────────

/**
 * Compose a ThreePartPrompt into an InternalMessage array.
 *
 * Produces:
 * - A system message with the system part (if non-empty)
 * - A user message combining context + instruction with clear labels
 *
 * @param prompt - Three-part prompt structure.
 * @param options - Composition options.
 * @returns Array of InternalMessage objects.
 */
export function composeMessages(prompt: ThreePartPrompt, options?: ThreePartOptions): InternalMessage[] {
  const sep = options?.separator ?? '\n\n';
  const addLabels = options?.addLabels ?? true;
  const messages: InternalMessage[] = [];

  // System message
  if (prompt.system) {
    messages.push({ role: 'system', content: prompt.system });
  }

  // User message: context + instruction
  const parts: string[] = [];

  if (prompt.context) {
    const contextBlock = addLabels
      ? `[Context]\n${prompt.context}`
      : prompt.context;
    parts.push(contextBlock);
  }

  if (prompt.instruction) {
    const instructionBlock = addLabels
      ? `[Instruction]\n${prompt.instruction}`
      : prompt.instruction;
    parts.push(instructionBlock);
  }

  if (parts.length > 0) {
    messages.push({ role: 'user', content: parts.join(sep) });
  }

  return messages;
}

// ── Optimizer ──────────────────────────────────────────────────

/**
 * Optimize an existing message array by applying the three-part pattern.
 *
 * Extracts system content from user messages that contain role/persona
 * instructions mixed with actual content, and restructures into clean
 * system + user messages.
 *
 * @param messages - Existing InternalMessage array.
 * @param options - Optimization options.
 * @returns Optimized message array with clear separation.
 */
export function optimizeMessages(
  messages: InternalMessage[],
  options?: ThreePartOptions,
): InternalMessage[] {
  // If there's already a well-structured set (system + user), return as-is
  const hasSystem = messages.some((m) => m.role === 'system');
  const hasMultipleUserMessages = messages.filter((m) => m.role === 'user').length > 1;

  // Only optimize simple cases: single user message without system
  if (hasSystem || hasMultipleUserMessages || messages.length > 3) {
    return messages;
  }

  // Find the single user message to split
  const userMsg = messages.find((m) => m.role === 'user');
  if (!userMsg || typeof userMsg.content !== 'string') {
    return messages;
  }

  const threePart = splitPrompt(userMsg.content, options);

  // Only restructure if we actually found meaningful separation
  if (!threePart.system && !threePart.context) {
    return messages;
  }

  return composeMessages(threePart, options);
}
