/**
 * Pure runtime feature-flag readers.
 *
 * These helpers intentionally read process.env at call time so tests and
 * runtime code can observe env mutations after module import.
 */

export function useTransformers(): boolean {
  return process.env['USE_TRANSFORMERS'] === 'true';
}

export function optimizeMessagesEnabled(): boolean {
  return process.env['OPTIMIZE_MESSAGES_ENABLED'] !== 'false';
}

export function outputCompressionEnabled(): boolean {
  return process.env['ENABLE_OUTPUT_COMPRESSION'] !== 'false';
}

export function approvalFlowsEnabled(): boolean {
  return process.env['APPROVAL_FLOWS_ENABLED'] !== 'false';
}

export function circuitBreakerEnabled(): boolean {
  return process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] !== 'false';
}

export function modelRoutingEnabled(): boolean {
  return process.env['MODEL_ROUTING_ENABLED'] === 'true';
}

export function latencyRoutingEnabled(): boolean {
  return process.env['LATENCY_ROUTING'] === 'true';
}

export function freeModelCatalogEnabled(): boolean {
  return process.env['FREE_MODEL_CATALOG'] === 'true';
}

export function localLLMEnabled(): boolean {
  return process.env['LOCAL_LLM_ENABLED'] === 'true';
}

export function autoDiscoverModelsEnabled(): boolean {
  return process.env['AUTO_DISCOVER_MODELS'] === 'true';
}
