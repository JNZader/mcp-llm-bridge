const DYNAMIC_PLUGIN_DIAGNOSTIC_CODE = {
  INVALID_PLUGIN_SHAPE: 'invalid-plugin-shape',
  INVALID_TOOL_SECURITY: 'invalid-tool-security',
  LOAD_FAILED: 'load-failed',
  LOAD_TIMEOUT: 'load-timeout',
  BUILT_IN_TOOL_COLLISION: 'built-in-tool-collision',
  PLUGIN_TOOL_COLLISION: 'plugin-tool-collision',
  UNKNOWN: 'unknown',
} as const;

type DynamicPluginDiagnosticCode = (typeof DYNAMIC_PLUGIN_DIAGNOSTIC_CODE)[keyof typeof DYNAMIC_PLUGIN_DIAGNOSTIC_CODE];

const LOAD_ISSUE_CODE: Record<string, DynamicPluginDiagnosticCode> = {
  'invalid-top-level-shape': DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.INVALID_PLUGIN_SHAPE,
  'invalid-tool-security': DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.INVALID_TOOL_SECURITY,
  'load-failed': DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.LOAD_FAILED,
  'load-timeout': DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.LOAD_TIMEOUT,
};

const COLLISION_ISSUE_CODE: Record<string, DynamicPluginDiagnosticCode> = {
  'built-in-tool-name': DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.BUILT_IN_TOOL_COLLISION,
  'plugin-tool-name': DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.PLUGIN_TOOL_COLLISION,
};

export interface DynamicPluginDiagnosticCount {
  code: DynamicPluginDiagnosticCode;
  count: number;
}

export interface DynamicPluginDiagnostics {
  enabled: boolean;
  loaded: number;
  issues: DynamicPluginDiagnosticCount[];
}

export interface DynamicPluginDiagnosticSource {
  enabled: unknown;
  loaded: unknown;
  skipped: unknown;
  errors: unknown;
  collisions: unknown;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function issueCode(value: unknown, codes: Record<string, DynamicPluginDiagnosticCode>): DynamicPluginDiagnosticCode {
  if (typeof value !== 'object' || value === null) {
    return DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.UNKNOWN;
  }

  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && Object.hasOwn(codes, code)
    ? codes[code]!
    : DYNAMIC_PLUGIN_DIAGNOSTIC_CODE.UNKNOWN;
}

function countCodes(
  values: unknown,
  codes: Record<string, DynamicPluginDiagnosticCode>,
  counts: Map<DynamicPluginDiagnosticCode, number>,
): void {
  if (!Array.isArray(values)) return;

  for (const value of values) {
    const code = issueCode(value, codes);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
}

function countList(counts: Map<DynamicPluginDiagnosticCode, number>): DynamicPluginDiagnosticCount[] {
  return Object.values(DYNAMIC_PLUGIN_DIAGNOSTIC_CODE).flatMap((code) => {
    const count = counts.get(code) ?? 0;
    return count > 0 ? [{ code, count }] : [];
  });
}

/**
 * Creates a detached, allowlisted diagnostics snapshot from a dynamic plugin
 * load summary. It intentionally reads only status, collection sizes, and
 * issue codes; identity, path, tool, and message fields are not inspected.
 */
export function createDynamicPluginDiagnostics(summary: DynamicPluginDiagnosticSource): DynamicPluginDiagnostics {
  const counts = new Map<DynamicPluginDiagnosticCode, number>();
  countCodes(summary.skipped, LOAD_ISSUE_CODE, counts);
  countCodes(summary.errors, LOAD_ISSUE_CODE, counts);
  countCodes(summary.collisions, COLLISION_ISSUE_CODE, counts);

  return {
    enabled: summary.enabled === true,
    loaded: arrayLength(summary.loaded),
    issues: countList(counts),
  };
}
