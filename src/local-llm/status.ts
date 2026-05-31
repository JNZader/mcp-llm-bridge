import {
  getLocalLLMStatus,
  type GetLocalLLMStatusOptions,
} from './detector.js';
import type {
  LocalLLMConfig,
  LocalLLMStatus,
} from './types.js';

export interface SlimLocalLLMStatusBackend {
  backend: LocalLLMStatus['backends'][number]['backend'];
  status: LocalLLMStatus['backends'][number]['status'];
  baseUrl: string;
  error?: string;
  modelCount: number;
}

export interface SlimLocalLLMStatus {
  enabled: boolean;
  ready: boolean;
  checkedAt: string;
  source: LocalLLMStatus['source'];
  cacheHit: boolean;
  backendCount: number;
  connectedBackendCount: number;
  modelCount: number;
  backends: SlimLocalLLMStatusBackend[];
}

export function toSlimLocalLLMStatus(status: LocalLLMStatus): SlimLocalLLMStatus {
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

export async function getSlimLocalLLMStatus(
  config?: Partial<LocalLLMConfig>,
  options?: GetLocalLLMStatusOptions,
): Promise<SlimLocalLLMStatus> {
  const status = await getLocalLLMStatus(config, options);
  return toSlimLocalLLMStatus(status);
}
