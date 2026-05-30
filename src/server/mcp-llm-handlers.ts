import type { Router } from '../core/router.js';
import type { BridgeOrchestrator } from '../bridge/orchestrator.js';
import { detectLocalLLMs, pickBestLocalModel } from '../local-llm/detector.js';
import { callLocalLLM, LocalLLMError } from '../local-llm/client.js';
import { classifyForOffload, meetsOffloadThreshold } from '../local-llm/router.js';
import { discoverModels } from '../model-discovery/discovery.js';
import { DEFAULT_LOCAL_LLM_CONFIG } from '../local-llm/types.js';
import type { McpToolResult } from './mcp-tool-handlers.js';

function jsonResult(payload: unknown, isError?: boolean): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

export async function handleLlmGenerateTool(
  args: Record<string, unknown>,
  router: Router,
  bridge?: BridgeOrchestrator | null,
): Promise<McpToolResult> {
  let prompt = args['prompt'] as string | undefined;
  const system = args['system'] as string | undefined;
  const context = args['context'] as string | undefined;
  const instruction = args['instruction'] as string | undefined;

  if (context || instruction) {
    const parts: string[] = [];
    if (context) parts.push(`[Context]\n${context}`);
    if (instruction) parts.push(`[Instruction]\n${instruction}`);
    prompt = parts.join('\n\n') ?? prompt ?? '';
  }

  const request = {
    prompt: prompt ?? '',
    system,
    provider: args['provider'] as string | undefined,
    model: args['model'] as string | undefined,
    maxTokens: args['maxTokens'] as number | undefined,
    project: args['project'] as string | undefined,
  };

  if (bridge && !request.provider && !request.model) {
    return jsonResult(await bridge.generate(request));
  }

  return jsonResult(await router.generate(request));
}

export async function handleLocalLlmGenerateTool(
  args: Record<string, unknown>,
  router: Router,
): Promise<McpToolResult> {
  const prompt = args['prompt'] as string;
  const system = args['system'] as string | undefined;
  const preferredModel = args['preferredModel'] as string | undefined;
  const maxTokens = args['maxTokens'] as number | undefined;

  const localEnabled = process.env['LOCAL_LLM_ENABLED'] === 'true';
  if (!localEnabled) {
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({ ...result, backend: 'cloud', reason: 'LOCAL_LLM_ENABLED=false' });
  }

  const detections = await detectLocalLLMs();
  const localModel = pickBestLocalModel(detections, preferredModel);

  if (!localModel) {
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({ ...result, backend: 'cloud', reason: 'No local models available' });
  }

  const classification = classifyForOffload(prompt);
  const minConfidence = DEFAULT_LOCAL_LLM_CONFIG.minOffloadConfidence;
  if (!meetsOffloadThreshold(classification, minConfidence)) {
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: `Task not offloadable: ${classification.reason}`,
    });
  }

  try {
    const localResult = await callLocalLLM(localModel, prompt, system);
    return jsonResult({
      text: localResult.text,
      model: localResult.model,
      backend: 'local',
      provider: 'local-llm',
      resolvedProvider: 'local-llm',
      resolvedModel: localResult.model,
      fallbackUsed: false,
      latencyMs: localResult.latencyMs,
      tokensUsed: localResult.tokensUsed,
    });
  } catch (error) {
    if (error instanceof LocalLLMError) {
      const cloudResult = await router.generate({ prompt, system, maxTokens });
      return jsonResult({
        ...cloudResult,
        backend: 'cloud',
        fallbackUsed: true,
        fallbackReason: `Local LLM failed: ${error.message}`,
      });
    }
    throw error;
  }
}

export async function handleDiscoverModelsTool(
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const hfToken = args['hfToken'] as string | undefined;
  try {
    const result = await discoverModels(
      { hfToken: hfToken ?? process.env['HF_TOKEN'], enabled: true },
      {
        ollamaUrl: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
        lmStudioUrl: process.env['LM_STUDIO_URL'] ?? 'http://localhost:1234',
      },
    );
    return jsonResult({
      models: result.models,
      backendsScanned: result.backendsScanned,
      enrichedCount: result.enrichedCount,
      unenrichedCount: result.unenrichedCount,
      errors: result.errors,
      timestamp: result.timestamp,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResult({ error: msg }, true);
  }
}
