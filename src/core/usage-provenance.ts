import {
  USAGE_PROVENANCE_REASON,
  USAGE_PROVENANCE_STATUS,
  type UsageProvenance,
  type CostEvidence,
} from './types.js';
import { getModelPrice } from './pricing.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

export function readUsageProvenance(value: unknown): UsageProvenance | undefined {
  if (!isRecord(value)) return undefined;

  if (value['status'] === USAGE_PROVENANCE_STATUS.REPORTED) {
    const inputTokens = value['inputTokens'];
    const outputTokens = value['outputTokens'];
    if (
      value['origin'] !== 'cli-output' ||
      value['eventCount'] !== 1 ||
      !hasOwn(value, 'inputTokens') ||
      !hasOwn(value, 'outputTokens') ||
      !isSafeNonNegativeInteger(inputTokens) ||
      !isSafeNonNegativeInteger(outputTokens) ||
      inputTokens > Number.MAX_SAFE_INTEGER - outputTokens
    ) {
      return undefined;
    }

    return {
      status: USAGE_PROVENANCE_STATUS.REPORTED,
      origin: 'cli-output',
      eventCount: 1,
      inputTokens,
      outputTokens,
    };
  }

  if (value['status'] === USAGE_PROVENANCE_STATUS.PARTIAL) {
    const hasInput = hasOwn(value, 'inputTokens');
    const hasOutput = hasOwn(value, 'outputTokens');
    if (value['origin'] !== 'cli-output' || value['eventCount'] !== 1 || hasInput === hasOutput) {
      return undefined;
    }

    if (hasInput && isSafeNonNegativeInteger(value['inputTokens'])) {
      return {
        status: USAGE_PROVENANCE_STATUS.PARTIAL,
        origin: 'cli-output',
        eventCount: 1,
        inputTokens: value['inputTokens'],
      };
    }

    if (hasOutput && isSafeNonNegativeInteger(value['outputTokens'])) {
      return {
        status: USAGE_PROVENANCE_STATUS.PARTIAL,
        origin: 'cli-output',
        eventCount: 1,
        outputTokens: value['outputTokens'],
      };
    }

    return undefined;
  }

  if (
    value['status'] === USAGE_PROVENANCE_STATUS.UNKNOWN &&
    (value['reason'] === USAGE_PROVENANCE_REASON.ABSENT ||
      value['reason'] === USAGE_PROVENANCE_REASON.INVALID ||
      value['reason'] === USAGE_PROVENANCE_REASON.MULTIPLE_EVENTS ||
      value['reason'] === USAGE_PROVENANCE_REASON.OVERFLOW)
  ) {
    return {
      status: USAGE_PROVENANCE_STATUS.UNKNOWN,
      reason: value['reason'],
    };
  }

  return undefined;
}

/**
 * Build explicit zero-cost evidence only when usage is complete and the gateway
 * catalog marks both token directions as zero-priced. This never attests to a
 * provider charge or subscription entitlement.
 */
export function estimateZeroCostEvidence(
  model: string,
  usage: UsageProvenance | undefined,
): CostEvidence | undefined {
  if (usage?.status !== USAGE_PROVENANCE_STATUS.REPORTED) return undefined;

  const catalogModel = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  const price = getModelPrice(catalogModel);
  if (
    !price
    || price.inputPerMTok !== 0
    || price.outputPerMTok !== 0
    || price.cacheReadPerMTok !== 0
    || price.cacheWritePerMTok !== 0
  ) return undefined;

  return {
    status: 'estimated_zero',
    source: 'catalog_estimate',
    estimatedCost: 0,
    currency: 'USD',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    providerChargeAttestation: false,
    caveat: 'Estimated from gateway model-price metadata; not provider charge attestation.',
  };
}
