import type { Router } from '../core/router.js';
import type { BridgeOrchestrator } from '../bridge/orchestrator.js';
import type { Vault } from '../vault/vault.js';
import { getLocalLLMStatus, pickBestLocalModel } from '../local-llm/detector.js';
import { callLocalLLM, LocalLLMError } from '../local-llm/client.js';
import { classifyForOffload, meetsOffloadThreshold } from '../local-llm/router.js';
import { discoverModels } from '../model-discovery/discovery.js';
import { getLocalLLMUrls, resolveHfToken } from '../core/local-llm-env.js';
import { localLLMEnabled } from '../core/runtime-flags.js';
import { DEFAULT_LOCAL_LLM_CONFIG, type LocalLLMStatus } from '../local-llm/types.js';
import type { McpToolResult } from './mcp-tool-handlers.js';

function jsonResult(payload: unknown, isError?: boolean): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function toSlimLocalLLMStatus(status: LocalLLMStatus) {
  return {
    enabled: status.enabled,
    ready: status.ready,
    checkedAt: status.checkedAt,
    source: status.source,
    cacheHit: status.cacheHit,
    backendCount: status.backendCount,
    connectedBackendCount: status.connectedBackendCount,
    modelCount: status.modelCount,
    backends: status.backends.map((backend) => ({
      backend: backend.backend,
      status: backend.status,
      baseUrl: backend.baseUrl,
      error: backend.error,
      modelCount: backend.modelCount,
    })),
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

  if (!localLLMEnabled()) {
    const localLLMStatus = await getLocalLLMStatus(
      { enabled: false, ...getLocalLLMUrls() },
      { skipDetectionWhenDisabled: true },
    );
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: 'LOCAL_LLM_ENABLED=false',
      localLLMStatus: toSlimLocalLLMStatus(localLLMStatus),
    });
  }

  const localLLMStatus = await getLocalLLMStatus({ enabled: true, ...getLocalLLMUrls() });
  const localModel = pickBestLocalModel(localLLMStatus.backends, preferredModel);

  if (!localModel) {
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: 'No local models available',
      localLLMStatus: toSlimLocalLLMStatus(localLLMStatus),
    });
  }

  const classification = classifyForOffload(prompt);
  const minConfidence = DEFAULT_LOCAL_LLM_CONFIG.minOffloadConfidence;
  if (!meetsOffloadThreshold(classification, minConfidence)) {
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: `Task not offloadable: ${classification.reason}`,
      localLLMStatus: toSlimLocalLLMStatus(localLLMStatus),
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
        localLLMStatus: toSlimLocalLLMStatus(localLLMStatus),
      });
    }
    throw error;
  }
}

export async function handleDiscoverModelsTool(
  args: Record<string, unknown>,
  vault?: Vault,
): Promise<McpToolResult> {
  const hfToken = args['hfToken'] as string | undefined;
  const enabled = args['enabled'] === undefined ? true : args['enabled'] !== false;
  try {
    const result = await discoverModels(
      { hfToken: resolveHfToken(hfToken), enabled },
      getLocalLLMUrls(),
      vault?.getDb(),
    );
    return jsonResult({
      models: result.models,
      backendsScanned: result.backendsScanned,
      enrichedCount: result.enrichedCount,
      unenrichedCount: result.unenrichedCount,
      errors: result.errors,
      timestamp: result.timestamp,
      partial: result.partial,
      snapshotUsed: result.snapshotUsed,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResult({ error: msg }, true);
  }
}
