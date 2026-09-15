import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  createDynamicPluginDiagnostics,
  type DynamicPluginDiagnosticSource,
} from '../../src/server/plugin-diagnostics.js';
import {
  getDynamicPluginDiagnostics,
  getDynamicPluginLoadSummary,
  type DynamicPluginDiagnostics,
} from '../../src/server/mcp.js';

function source(overrides: Partial<DynamicPluginDiagnosticSource> = {}): DynamicPluginDiagnosticSource {
  return {
    enabled: true,
    loaded: [],
    skipped: [],
    errors: [],
    collisions: [],
    ...overrides,
  };
}

describe('dynamic plugin diagnostics', () => {
  it('reports a safe default and keeps the legacy summary unchanged', () => {
    const legacy = getDynamicPluginLoadSummary();

    const diagnostics: DynamicPluginDiagnostics = getDynamicPluginDiagnostics();

    assert.deepStrictEqual(diagnostics, {
      enabled: false,
      loaded: 0,
      issues: [],
    });
    assert.deepStrictEqual(legacy, {
      enabled: false,
      directory: '',
      loaded: [],
      skipped: [],
      errors: [],
      collisions: [],
    });
  });

  it('counts only fixed issue codes across skipped errors and collisions', () => {
    const diagnostics = createDynamicPluginDiagnostics(source({
      loaded: [{ plugin: 'private-plugin' }, { plugin: 'other-private-plugin' }],
      skipped: [
        { code: 'invalid-top-level-shape' },
        { code: 'invalid-tool-security' },
      ],
      errors: [
        { code: 'load-failed' },
        { code: 'load-timeout' },
        { code: 'load-failed' },
      ],
      collisions: [
        { code: 'built-in-tool-name' },
        { code: 'plugin-tool-name' },
      ],
    }));

    assert.deepStrictEqual(diagnostics, {
      enabled: true,
      loaded: 2,
      issues: [
        { code: 'invalid-plugin-shape', count: 1 },
        { code: 'invalid-tool-security', count: 1 },
        { code: 'load-failed', count: 2 },
        { code: 'load-timeout', count: 1 },
        { code: 'built-in-tool-collision', count: 1 },
        { code: 'plugin-tool-collision', count: 1 },
      ],
    });
  });

  it('uses a fixed fallback for unrecognized codes without exposing a canary', () => {
    const diagnostics = createDynamicPluginDiagnostics(source({
      skipped: [{ code: 'canary-private-code' }, { code: undefined }],
      errors: [{ code: 'future-private-code' }],
      collisions: [{ code: 'another-private-code' }],
    }));

    assert.deepStrictEqual(diagnostics.issues, [{ code: 'unknown', count: 4 }]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /canary|private/i);
  });

  it('maps prototype-named codes to the fixed fallback in every issue collection', () => {
    const cases: ReadonlyArray<readonly [keyof Pick<DynamicPluginDiagnosticSource, 'skipped' | 'errors' | 'collisions'>, string]> = [
      ['skipped', 'toString'],
      ['errors', 'constructor'],
      ['collisions', '__proto__'],
    ];

    for (const [collection, rawCode] of cases) {
      const diagnostics = createDynamicPluginDiagnostics(source({
        [collection]: [{ code: rawCode }],
      }));

      assert.deepStrictEqual(diagnostics.issues, [{ code: 'unknown', count: 1 }], `${collection}:${rawCode}`);
    }
  });

  it('does not inspect raw issue identity message or loaded-entry fields', () => {
    const issue = { code: 'load-failed' } as Record<string, unknown>;
    for (const field of ['plugin', 'file', 'toolName', 'message']) {
      Object.defineProperty(issue, field, {
        get: () => {
          throw new Error(`${field} must not be read`);
        },
      });
    }

    const loadedEntry = {} as Record<string, unknown>;
    Object.defineProperty(loadedEntry, 'plugin', {
      get: () => {
        throw new Error('loaded plugin identity must not be read');
      },
    });

    assert.deepStrictEqual(createDynamicPluginDiagnostics(source({ loaded: [loadedEntry], errors: [issue] })), {
      enabled: true,
      loaded: 1,
      issues: [{ code: 'load-failed', count: 1 }],
    });
  });

  it('returns a detached snapshot', () => {
    const raw = source({
      loaded: [{}],
      errors: [{ code: 'load-failed' }],
    });
    const diagnostics = createDynamicPluginDiagnostics(raw);

    diagnostics.issues[0]!.count = 999;
    (raw.loaded as unknown[]).push({});
    (raw.errors as Array<{ code: string }>).push({ code: 'load-timeout' });

    assert.deepStrictEqual(diagnostics, {
      enabled: true,
      loaded: 1,
      issues: [{ code: 'load-failed', count: 999 }],
    });
    assert.deepStrictEqual(createDynamicPluginDiagnostics(raw), {
      enabled: true,
      loaded: 2,
      issues: [
        { code: 'load-failed', count: 1 },
        { code: 'load-timeout', count: 1 },
      ],
    });
  });
});
