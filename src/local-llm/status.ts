import {
  getLocalLLMStatus,
  type GetLocalLLMStatusOptions,
} from './detector.js';
import type {
  LocalLLMConfig,
  LocalModel,
  LocalLLMStatus,
} from './types.js';

export interface SlimLocalLLMStatusModel {
  id: LocalModel['id'];
  name: LocalModel['name'];
  loaded: LocalModel['loaded'];
  parameterSize?: LocalModel['parameterSize'];
  contextWindow?: LocalModel['contextWindow'];
}

export interface SlimLocalLLMStatusBackend {
  backend: LocalLLMStatus['backends'][number]['backend'];
  status: LocalLLMStatus['backends'][number]['status'];
  baseUrl: string;
  error?: string;
  modelCount: number;
  models: SlimLocalLLMStatusModel[];
}

export interface SlimLocalLLMStatus {
  enabled: boolean;
  ready: boolean;
  readyReason: string;
  checkedAt: string;
  source: LocalLLMStatus['source'];
  cacheHit: boolean;
  backendCount: number;
  connectedBackendCount: number;
  disconnectedBackendCount: number;
  errorBackendCount: number;
  modelCount: number;
  backends: SlimLocalLLMStatusBackend[];
}

export function toSlimLocalLLMStatus(status: LocalLLMStatus): SlimLocalLLMStatus {
  return {
    enabled: status.enabled,
    ready: status.ready,
    readyReason: status.readyReason,
    checkedAt: status.checkedAt,
    source: status.source,
    cacheHit: status.cacheHit,
    backendCount: status.backendCount,
    connectedBackendCount: status.connectedBackendCount,
    disconnectedBackendCount: status.disconnectedBackendCount,
    errorBackendCount: status.errorBackendCount,
    modelCount: status.modelCount,
    backends: status.backends.map((backend) => ({
      backend: backend.backend,
      status: backend.status,
      baseUrl: backend.baseUrl,
      error: backend.error,
      modelCount: backend.modelCount,
      models: backend.models.map((model) => ({
        id: model.id,
        name: model.name,
        loaded: model.loaded,
        parameterSize: model.parameterSize,
        contextWindow: model.contextWindow,
      })),
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
