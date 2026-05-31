/**
 * Model name resolver — map local model IDs to HuggingFace model IDs.
 *
 * Local runtimes use different naming conventions than HuggingFace:
 * - Ollama: "llama3.2:3b", "codellama:7b-instruct"
 * - LM Studio: "llama-3.2-3b-instruct-GGUF"
 *
 * This module resolves these to HF repo IDs like "meta-llama/Llama-3.2-3B".
 */

/**
 * Known mapping from common local model patterns to HF repo IDs.
 * Pattern is matched case-insensitively against the local model ID.
 */
const KNOWN_MAPPINGS: Array<{ pattern: RegExp; hfId: string }> = [
  // Llama family
  { pattern: /llama[- ]?3\.?2.*:?1b/i, hfId: 'meta-llama/Llama-3.2-1B' },
  { pattern: /llama[- ]?3\.?2.*:?3b/i, hfId: 'meta-llama/Llama-3.2-3B' },
  { pattern: /llama[- ]?3\.?1.*:?8b/i, hfId: 'meta-llama/Llama-3.1-8B' },
  { pattern: /llama[- ]?3\.?1.*:?70b/i, hfId: 'meta-llama/Llama-3.1-70B' },
  { pattern: /llama[- ]?3.*:?8b/i, hfId: 'meta-llama/Meta-Llama-3-8B' },
  { pattern: /llama[- ]?3.*:?70b/i, hfId: 'meta-llama/Meta-Llama-3-70B' },

  // CodeLlama
  { pattern: /codellama.*:?7b/i, hfId: 'codellama/CodeLlama-7b-hf' },
  { pattern: /codellama.*:?13b/i, hfId: 'codellama/CodeLlama-13b-hf' },
  { pattern: /codellama.*:?34b/i, hfId: 'codellama/CodeLlama-34b-hf' },

  // Mistral
  { pattern: /mistral.*:?7b/i, hfId: 'mistralai/Mistral-7B-v0.3' },
  { pattern: /mixtral.*:?8x7b/i, hfId: 'mistralai/Mixtral-8x7B-v0.1' },

  // Gemma
  { pattern: /gemma[- ]?2.*:?2b/i, hfId: 'google/gemma-2-2b' },
  { pattern: /gemma[- ]?2.*:?9b/i, hfId: 'google/gemma-2-9b' },
  { pattern: /gemma[- ]?2.*:?27b/i, hfId: 'google/gemma-2-27b' },

  // Phi
  { pattern: /phi[- ]?3.*mini/i, hfId: 'microsoft/Phi-3-mini-4k-instruct' },
  { pattern: /phi[- ]?3.*small/i, hfId: 'microsoft/Phi-3-small-8k-instruct' },
  { pattern: /phi[- ]?3.*medium/i, hfId: 'microsoft/Phi-3-medium-4k-instruct' },

  // Qwen
  { pattern: /qwen[- ]?2\.?5.*coder.*:?0\.5b/i, hfId: 'Qwen/Qwen2.5-Coder-0.5B-Instruct' },
  { pattern: /qwen[- ]?2\.?5.*coder.*:?1\.5b/i, hfId: 'Qwen/Qwen2.5-Coder-1.5B-Instruct' },
  { pattern: /qwen[- ]?2\.?5.*coder.*:?3b/i, hfId: 'Qwen/Qwen2.5-Coder-3B-Instruct' },
  { pattern: /qwen[- ]?2\.?5.*coder.*:?7b/i, hfId: 'Qwen/Qwen2.5-Coder-7B-Instruct' },
  { pattern: /codeqwen[- ]?1\.?5.*:?7b/i, hfId: 'Qwen/CodeQwen1.5-7B-Chat' },
  { pattern: /qwen[- ]?2\.?5.*:?0\.5b/i, hfId: 'Qwen/Qwen2.5-0.5B' },
  { pattern: /qwen[- ]?2\.?5.*:?1\.5b/i, hfId: 'Qwen/Qwen2.5-1.5B' },
  { pattern: /qwen[- ]?2\.?5.*:?7b/i, hfId: 'Qwen/Qwen2.5-7B' },
  { pattern: /qwen[- ]?2\.?5.*:?72b/i, hfId: 'Qwen/Qwen2.5-72B' },

  // DeepSeek
  { pattern: /deepseek.*coder.*:?6\.7b/i, hfId: 'deepseek-ai/deepseek-coder-6.7b-base' },
  { pattern: /deepseek.*coder.*:?33b/i, hfId: 'deepseek-ai/deepseek-coder-33b-base' },

  // StarCoder
  { pattern: /starcoder2.*:?3b/i, hfId: 'bigcode/starcoder2-3b' },
  { pattern: /starcoder2.*:?7b/i, hfId: 'bigcode/starcoder2-7b' },
  { pattern: /starcoder2.*:?15b/i, hfId: 'bigcode/starcoder2-15b' },
];

/**
 * Resolve a local model ID to a HuggingFace model ID.
 *
 * Uses pattern matching against known model families.
 * Returns null if no match is found.
 */
export function resolveHFModelId(localModelId: string): string | null {
  const normalizedModelId = normalizeLocalModelId(localModelId);

  for (const mapping of KNOWN_MAPPINGS) {
    if (mapping.pattern.test(normalizedModelId)) {
      return mapping.hfId;
    }
  }
  return null;
}

function normalizeLocalModelId(localModelId: string): string {
  return localModelId
    .trim()
    .replace(/:latest$/i, '')
    .replace(/[-_.]gguf$/i, '')
    .replace(/[-_.](?:q\d+(?:_k_[msl]|_0)?|iq\d+(?:_[a-z0-9]+)?|fp16|fp8|bf16)$/i, '');
}

/**
 * Infer capabilities from model tags and pipeline type.
 */
export function inferCapabilities(
  tags: string[],
  pipelineTag?: string,
): string[] {
  const capabilities: string[] = [];

  // Pipeline tag inference
  if (pipelineTag === 'text-generation') capabilities.push('chat');
  if (pipelineTag === 'text2text-generation') capabilities.push('chat');
  if (pipelineTag === 'feature-extraction') capabilities.push('embedding');

  // Tag-based inference
  const normalizedTags = tags.map((t) => t.toLowerCase());
  const tagSet = new Set(normalizedTags);
  const tokenSet = new Set(
    normalizedTags.flatMap((tag) => tag.split(/[^a-z0-9.]+/).filter(Boolean)),
  );

  if (tagSet.has('code') || tagSet.has('coding')) capabilities.push('code');
  if (tagSet.has('conversational')) capabilities.push('chat');
  if (tagSet.has('math') || tagSet.has('reasoning')) capabilities.push('reasoning');
  if (
    tokenSet.has('chat') ||
    tokenSet.has('instruct') ||
    tokenSet.has('assistant')
  ) {
    capabilities.push('chat');
  }
  if (
    tokenSet.has('coder') ||
    tokenSet.has('codeqwen') ||
    tokenSet.has('starcoder') ||
    tokenSet.has('codellama')
  ) {
    capabilities.push('code');
  }

  // Deduplicate
  return [...new Set(capabilities)];
}

/**
 * Recommend task types based on model capabilities and size.
 */
export function recommendTasks(
  capabilities: string[],
  parameterSize?: number,
): string[] {
  const tasks: string[] = [];
  const capSet = new Set(capabilities);

  // Small models (< 7B) are good for simple tasks
  const isSmall = parameterSize !== undefined && parameterSize < 7;

  if (capSet.has('chat')) {
    tasks.push('commit-message', 'summarization', 'translation');
    if (isSmall) {
      tasks.push('boilerplate');
    }
  }

  if (capSet.has('code')) {
    tasks.push('boilerplate', 'format-conversion', 'style-check');
  }

  return [...new Set(tasks)];
}
