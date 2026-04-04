/**
 * Bridge config loader — reads and validates bridge.yaml.
 *
 * Loads task-type routing configuration from ~/.llm-gateway/bridge.yaml.
 * Returns null when the config file is absent (bridge disabled).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../core/logger.js';
import type { BridgeConfig, BridgeConfigRaw } from './types.js';

const VALID_TASK_TYPES = new Set(['large-context', 'code-review', 'fast-completion', 'default']);

/** Default bridge config path. */
export const BRIDGE_CONFIG_PATH = join(homedir(), '.llm-gateway', 'bridge.yaml');

/**
 * Parse a simple YAML subset for bridge config.
 *
 * Supports flat key: value pairs, nested objects (routes:), and arrays (- item).
 * Does NOT use a full YAML parser to avoid adding a dependency.
 */
export function parseSimpleYaml(content: string): BridgeConfigRaw {
  const result: BridgeConfigRaw = {};
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let arrayKey: string | null = null;
  const arrayValues: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const stripped = line.replace(/#.*$/, '').trimEnd();

    if (!stripped || stripped.trim() === '') continue;

    // Array item (  - value)
    const arrayMatch = stripped.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && arrayKey) {
      arrayValues.push(arrayMatch[1]!.trim());
      continue;
    }

    // Flush accumulated array when we hit a non-array line
    if (arrayKey && arrayValues.length > 0) {
      if (arrayKey === 'fallback_order') {
        result.fallback_order = [...arrayValues];
      }
      arrayValues.length = 0;
      arrayKey = null;
    }

    // Detect indentation to distinguish top-level from nested
    const indent = stripped.match(/^(\s*)/)?.[1]?.length ?? 0;

    // Reset section when we see a top-level line (no indent)
    if (indent === 0) {
      // Top-level key with no value (section header like "routes:")
      const sectionMatch = stripped.match(/^(\w[\w_]*):\s*$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1]!;
        if (currentSection === 'fallback_order') {
          arrayKey = 'fallback_order';
        }
        continue;
      }

      // Top-level key: value (like "default: claude-cli")
      const topLevelMatch = stripped.match(/^(\w[\w_]*):\s+(.+)$/);
      if (topLevelMatch) {
        currentSection = null;
        const [, key, value] = topLevelMatch;
        if (key === 'default') {
          result.default = value!.trim();
        }
        if (key === 'fallback_order') {
          // Inline array: [a, b, c]
          const inlineMatch = value!.match(/^\[(.+)]$/);
          if (inlineMatch) {
            result.fallback_order = inlineMatch[1]!.split(',').map((s) => s.trim());
          }
        }
        continue;
      }
    }

    // Nested key: value (under a section like "routes:")
    const nestedMatch = stripped.match(/^\s+(\S+):\s+(.+)$/);
    if (nestedMatch && currentSection === 'routes') {
      if (!result.routes) result.routes = {};
      result.routes[nestedMatch[1]!.trim()] = nestedMatch[2]!.trim();
      continue;
    }
  }

  // Flush trailing array
  if (arrayKey === 'fallback_order' && arrayValues.length > 0) {
    result.fallback_order = [...arrayValues];
  }

  return result;
}

/**
 * Validate and convert raw config into BridgeConfig.
 *
 * Skips routes with unknown task types (logs warning).
 * Returns null if validation fails critically.
 */
export function validateConfig(raw: BridgeConfigRaw): BridgeConfig | null {
  if (!raw.default) {
    logger.warn('Bridge config missing "default" provider');
    return null;
  }

  if (!raw.fallback_order || raw.fallback_order.length === 0) {
    logger.warn('Bridge config missing "fallback_order"');
    return null;
  }

  const routes = new Map<string, string>();

  if (raw.routes) {
    for (const [taskType, provider] of Object.entries(raw.routes)) {
      if (!VALID_TASK_TYPES.has(taskType)) {
        logger.warn({ taskType }, 'Bridge config: unknown task type in routes, skipping');
        continue;
      }
      routes.set(taskType, provider);
    }
  }

  return {
    routes,
    default: raw.default,
    fallbackOrder: raw.fallback_order,
  };
}

/**
 * Load bridge configuration from the default path.
 *
 * Returns null when the config file doesn't exist (bridge disabled)
 * or when validation fails.
 */
export function loadBridgeConfig(configPath?: string): BridgeConfig | null {
  const path = configPath ?? BRIDGE_CONFIG_PATH;

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, 'utf8');
    const raw = parseSimpleYaml(content);
    const config = validateConfig(raw);

    if (config) {
      logger.info(
        { routes: config.routes.size, fallbackOrder: config.fallbackOrder },
        'Bridge config loaded',
      );
    }

    return config;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to load bridge config');
    return null;
  }
}
