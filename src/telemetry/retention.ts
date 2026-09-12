import { isRegisteredTelemetryModel, isRegisteredTelemetryProvider } from '../core/provider-registry.js';

export const RETENTION_SINKS = {
  REQUEST_LOGS: "request_logs",
  USAGE: "usage",
  ANALYTICS: "analytics",
  COMPARISON_HISTORY: "comparison_history",
  ORDINARY_LOGS: "ordinary_logs",
  TRACES: "traces",
  METRICS: "metrics",
} as const;

export const RETENTION_VERIFICATION_OUTCOMES = {
  SUCCESS: "success",
  FAILED: "FAILED",
  INDETERMINATE: "INDETERMINATE",
  NOT_VERIFIED: "NOT_VERIFIED",
} as const;

export type RetentionSink = (typeof RETENTION_SINKS)[keyof typeof RETENTION_SINKS];
export type RetentionVerificationOutcome =
  (typeof RETENTION_VERIFICATION_OUTCOMES)[keyof typeof RETENTION_VERIFICATION_OUTCOMES];

export interface RetentionPolicy {
  sink: RetentionSink;
  retentionDays: number;
  deletionOwner: string;
  verificationControl: string;
}

export interface RetentionEvidence {
  expiredRecordsAbsent?: boolean;
  deletionFailed?: boolean;
  indeterminate?: boolean;
  exporterConfigured?: boolean;
  exporterDeletionReceipt?: boolean;
  exporterAbsenceConfirmed?: boolean;
}

export interface RetentionVerification {
  policy: RetentionPolicy;
  outcome: RetentionVerificationOutcome;
}

export interface RetentionProvenance {
  retentionDays: number;
  decision: string;
  evidenceBasis: string;
  sinks: RetentionPolicy[];
}

export interface ExternalRetentionReceipt {
  receiptId: string;
}

export interface ExternalRetentionBackend {
  configured: boolean;
  sink: RetentionSink;
  retentionDays: number;
  deletionOwner: string;
  deleteExpired: (beforeTimestamp: number) => Promise<ExternalRetentionReceipt | undefined>;
  confirmExpiredAbsent: (beforeTimestamp: number) => Promise<boolean>;
}

const THIRTY_DAY_RETENTION = 30;
const RETENTION_DECISION = "Maintainer-selected 30-day retention policy.";
const RETENTION_EVIDENCE_BASIS = "Maintainer decision; not externally researched, legally sufficient, or compliance mandated.";
const SAFE_METADATA_VALUE = /^[a-z0-9_][a-z0-9_.:/-]{0,199}$/;

const RETENTION_POLICIES: Record<RetentionSink, RetentionPolicy> = {
  [RETENTION_SINKS.REQUEST_LOGS]: {
    sink: RETENTION_SINKS.REQUEST_LOGS,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "request-log-storage",
    verificationControl: "expired age and count absence",
  },
  [RETENTION_SINKS.USAGE]: {
    sink: RETENTION_SINKS.USAGE,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "usage-cost-telemetry",
    verificationControl: "expired row query absence",
  },
  [RETENTION_SINKS.ANALYTICS]: {
    sink: RETENTION_SINKS.ANALYTICS,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "analytics-storage-export",
    verificationControl: "aggregate and exporter absence",
  },
  [RETENTION_SINKS.COMPARISON_HISTORY]: {
    sink: RETENTION_SINKS.COMPARISON_HISTORY,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "comparison-capability",
    verificationControl: "authorized deletion and readback denial",
  },
  [RETENTION_SINKS.ORDINARY_LOGS]: {
    sink: RETENTION_SINKS.ORDINARY_LOGS,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "logging-operations",
    verificationControl: "backend deletion receipt and absence",
  },
  [RETENTION_SINKS.TRACES]: {
    sink: RETENTION_SINKS.TRACES,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "tracing-collector",
    verificationControl: "collector and backend absence",
  },
  [RETENTION_SINKS.METRICS]: {
    sink: RETENTION_SINKS.METRICS,
    retentionDays: THIRTY_DAY_RETENTION,
    deletionOwner: "metrics-backend",
    verificationControl: "backend expiry and series absence",
  },
};

export function getRetentionPolicy(sink: RetentionSink): RetentionPolicy {
  return RETENTION_POLICIES[sink];
}

export function getRetentionProvenance(): RetentionProvenance {
  return {
    retentionDays: THIRTY_DAY_RETENTION,
    decision: RETENTION_DECISION,
    evidenceBasis: RETENTION_EVIDENCE_BASIS,
    sinks: Object.values(RETENTION_POLICIES).map((policy) => ({ ...policy })),
  };
}

export function verifyRetention(sink: RetentionSink, evidence?: RetentionEvidence): RetentionVerification {
  const policy = getRetentionPolicy(sink);
  if (!evidence) {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.NOT_VERIFIED };
  }
  if (evidence.deletionFailed) {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.FAILED };
  }
  if (evidence.indeterminate) {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.INDETERMINATE };
  }
  if (evidence.expiredRecordsAbsent === undefined) {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.NOT_VERIFIED };
  }
  if (evidence.expiredRecordsAbsent === false) {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.FAILED };
  }
  if (evidence.exporterConfigured) {
    if (evidence.exporterDeletionReceipt === false || evidence.exporterAbsenceConfirmed === false) {
      return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.FAILED };
    }
    if (evidence.exporterDeletionReceipt !== true || evidence.exporterAbsenceConfirmed !== true) {
      return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.INDETERMINATE };
    }
  }
  return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.SUCCESS };
}

export function isExternalRetentionBackendEligible(
  sink: RetentionSink,
  backend: ExternalRetentionBackend | undefined,
): backend is ExternalRetentionBackend {
  const policy = getRetentionPolicy(sink);
  return backend?.configured === true
    && backend.sink === sink
    && backend.retentionDays === policy.retentionDays
    && backend.deletionOwner === policy.deletionOwner;
}

export async function enforceExternalRetention(
  sink: RetentionSink,
  backend: ExternalRetentionBackend | undefined,
  beforeTimestamp = Date.now(),
): Promise<RetentionVerification> {
  const policy = getRetentionPolicy(sink);
  if (!isExternalRetentionBackendEligible(sink, backend)) {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.NOT_VERIFIED };
  }

  const cutoff = beforeTimestamp - policy.retentionDays * 24 * 60 * 60 * 1000;
  try {
    const receipt = await backend.deleteExpired(cutoff);
    if (!receipt?.receiptId) {
      return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.NOT_VERIFIED };
    }
    const expiredRecordsAbsent = await backend.confirmExpiredAbsent(cutoff);
    return verifyRetention(sink, {
      expiredRecordsAbsent,
      exporterConfigured: true,
      exporterDeletionReceipt: true,
      exporterAbsenceConfirmed: expiredRecordsAbsent,
    });
  } catch {
    return { policy, outcome: RETENTION_VERIFICATION_OUTCOMES.FAILED };
  }
}

export function assertSafeTelemetryMetadata(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, string | number | boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Telemetry sink input rejected");
  }
  const allowed = new Set(allowedKeys);
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (!allowed.has(key) || !isSafeTelemetryValue(entry) || !isRegistryBoundTelemetryIdentifier(key, entry)) {
      throw new Error("Telemetry sink input rejected");
    }
    metadata[key] = entry;
  }
  return metadata;
}

function isRegistryBoundTelemetryIdentifier(key: string, value: string | number | boolean): boolean {
  if (typeof value !== 'string') return true;
  if (key === 'provider') return isRegisteredTelemetryProvider(value);
  if (key === 'model') return isRegisteredTelemetryModel(value);
  return true;
}

function isSafeTelemetryValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return SAFE_METADATA_VALUE.test(value);
  return typeof value === "number" ? Number.isFinite(value) && value >= 0 : typeof value === "boolean";
}
