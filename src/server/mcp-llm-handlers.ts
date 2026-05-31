import type { Router } from '../core/router.js';
import type { BridgeOrchestrator } from '../bridge/orchestrator.js';
import type { Vault } from '../vault/vault.js';
import { getLocalLLMStatus, pickBestLocalModel } from '../local-llm/detector.js';
import { classifyForOffload } from '../local-llm/router.js';
import { getSlimLocalLLMStatus, toSlimLocalLLMStatus } from '../local-llm/status.js';
import { discoverModels } from '../model-discovery/discovery.js';
import { getLocalLLMUrls, resolveHfToken } from '../core/local-llm-env.js';
import { localLLMEnabled } from '../core/runtime-flags.js';
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

  if (!localLLMEnabled()) {
    const localLLMStatus = await getSlimLocalLLMStatus(
      { enabled: false, ...getLocalLLMUrls() },
      { skipDetectionWhenDisabled: true },
    );
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: 'LOCAL_LLM_ENABLED=false',
      localLLMStatus,
    });
  }

  const localLLMStatus = await getLocalLLMStatus({ enabled: true, ...getLocalLLMUrls() });
  const localModel = pickBestLocalModel(localLLMStatus.backends, preferredModel);
  const slimLocalLLMStatus = toSlimLocalLLMStatus(localLLMStatus);

  if (!localModel) {
    const result = await router.generate({ prompt, system, maxTokens });
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: 'No local models available',
      localLLMStatus: slimLocalLLMStatus,
    });
  }

  const result = await router.generate({
    prompt,
    system,
    maxTokens,
    provider: 'local-llm',
    model: localModel.id,
  });

  if (result.resolvedProvider === 'local-llm') {
    return jsonResult({
      ...result,
      backend: 'local',
      localBackend: localModel.backend,
      localModelId: localModel.id,
    });
  }

  const classification = classifyForOffload(prompt);
  if (!classification.shouldOffload) {
    return jsonResult({
      ...result,
      backend: 'cloud',
      reason: `Task not offloadable: ${classification.reason}`,
      localLLMStatus: slimLocalLLMStatus,
    });
  }

  return jsonResult({
    ...result,
    backend: 'cloud',
    fallbackReason: 'Local LLM provider failed and router fell back to a cloud provider',
    attemptedLocalBackend: localModel.backend,
    attemptedLocalModelId: localModel.id,
    localLLMStatus: slimLocalLLMStatus,
  });
}

export async function handleDiscoverModelsTool(
  args: Record<string, unknown>,
  vault?: Vault,
): Promise<McpToolResult> {
  const hfToken = args['hfToken'] as string | undefined;
  const enabled = args['enabled'] === undefined ? true : args['enabled'] !== false;
  try {
    const localLLMStatus = await getSlimLocalLLMStatus(
      { enabled: localLLMEnabled(), ...getLocalLLMUrls() },
      localLLMEnabled()
        ? { forceRefresh: true }
        : { skipDetectionWhenDisabled: true },
    );
    const result = await discoverModels(
      { hfToken: resolveHfToken(hfToken), enabled },
      getLocalLLMUrls(),
      vault?.getDb(),
      { forceRefreshLocalDetection: true },
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
      localLLMStatus,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResult({ error: msg }, true);
  }
}
