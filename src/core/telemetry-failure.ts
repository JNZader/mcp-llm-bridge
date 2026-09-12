const TELEMETRY_FAILURE_CODE = {
  RATE_LIMITED: 'rate_limited',
  TIMED_OUT: 'timed_out',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
} as const;

const TELEMETRY_FAILURE_CATEGORY = {
  CLIENT: 'client',
  PROVIDER: 'provider',
  TRANSIENT: 'transient',
} as const;

export type TelemetryFailureCode = (typeof TELEMETRY_FAILURE_CODE)[keyof typeof TELEMETRY_FAILURE_CODE];
export type TelemetryFailureCategory = (typeof TELEMETRY_FAILURE_CATEGORY)[keyof typeof TELEMETRY_FAILURE_CATEGORY];

export interface TelemetryFailure {
  code: TelemetryFailureCode;
  category: TelemetryFailureCategory;
  compatibilityText: string;
}

const SAFE_FAILURES: readonly TelemetryFailure[] = [
  { code: TELEMETRY_FAILURE_CODE.RATE_LIMITED, category: TELEMETRY_FAILURE_CATEGORY.PROVIDER, compatibilityText: 'Rate limit exceeded' },
  { code: TELEMETRY_FAILURE_CODE.TIMED_OUT, category: TELEMETRY_FAILURE_CATEGORY.TRANSIENT, compatibilityText: 'Provider request timed out' },
  { code: TELEMETRY_FAILURE_CODE.UNAVAILABLE, category: TELEMETRY_FAILURE_CATEGORY.PROVIDER, compatibilityText: 'Provider unavailable' },
  { code: TELEMETRY_FAILURE_CODE.FAILED, category: TELEMETRY_FAILURE_CATEGORY.CLIENT, compatibilityText: 'Provider request failed' },
];

export function normalizeTelemetryFailure(value: unknown): TelemetryFailure {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  const normalized = message.toLowerCase();

  if (normalized === TELEMETRY_FAILURE_CODE.RATE_LIMITED) return SAFE_FAILURES[0]!;
  if (normalized === TELEMETRY_FAILURE_CODE.TIMED_OUT) return SAFE_FAILURES[1]!;
  if (normalized === TELEMETRY_FAILURE_CODE.UNAVAILABLE) return SAFE_FAILURES[2]!;
  if (normalized === TELEMETRY_FAILURE_CODE.FAILED) return SAFE_FAILURES[3]!;
  if (normalized.includes('rate limit')) return SAFE_FAILURES[0]!;
  if (normalized.includes('timeout') || normalized.includes('timed out')) return SAFE_FAILURES[1]!;
  if (normalized.includes('unavailable') || normalized.includes('overloaded')) return SAFE_FAILURES[2]!;
  return SAFE_FAILURES[3]!;
}
