/**
 * Pricing — static price-per-token config for common LLM models.
 *
 * Prices are in USD per million tokens (input/output).
 * Uses fuzzy matching to handle model name variations
 * (e.g., "claude-3-5-sonnet" matches "claude-3.5-sonnet").
 *
 * Unknown models default to $0 cost — we log a warning but don't fail.
 */

import { logger } from './logger.js';

/** Price entry: USD per million tokens. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Static pricing table for common models.
 *
 * Prices sourced from provider pricing pages.
 * Keys are lowercase, normalized model names.
 */
const PRICE_TABLE: Record<string, ModelPrice> = {
  // ── Anthropic ─────────────────────────────────────────
  'claude-sonnet-4-20250514':    { inputPerMTok: 3.00,   outputPerMTok: 15.00 },
  'claude-opus-4-20250514':      { inputPerMTok: 15.00,  outputPerMTok: 75.00 },
  'claude-3.5-sonnet':           { inputPerMTok: 3.00,   outputPerMTok: 15.00 },
  'claude-3.5-haiku':            { inputPerMTok: 0.80,   outputPerMTok: 4.00 },
  'claude-3-opus':               { inputPerMTok: 15.00,  outputPerMTok: 75.00 },
  'claude-3-sonnet':             { inputPerMTok: 3.00,   outputPerMTok: 15.00 },
  'claude-3-haiku':              { inputPerMTok: 0.25,   outputPerMTok: 1.25 },

  // ── OpenAI ────────────────────────────────────────────
  'gpt-4o':                      { inputPerMTok: 2.50,   outputPerMTok: 10.00 },
  'gpt-4o-mini':                 { inputPerMTok: 0.15,   outputPerMTok: 0.60 },
  'gpt-4-turbo':                 { inputPerMTok: 10.00,  outputPerMTok: 30.00 },
  'gpt-4':                       { inputPerMTok: 30.00,  outputPerMTok: 60.00 },
  'o1':                          { inputPerMTok: 15.00,  outputPerMTok: 60.00 },
  'o1-mini':                     { inputPerMTok: 3.00,   outputPerMTok: 12.00 },
  'o3':                          { inputPerMTok: 10.00,  outputPerMTok: 40.00 },
  'o3-mini':                     { inputPerMTok: 1.10,   outputPerMTok: 4.40 },
  'o4-mini':                     { inputPerMTok: 1.10,   outputPerMTok: 4.40 },

  // ── Google ────────────────────────────────────────────
  'gemini-2.5-pro':              { inputPerMTok: 1.25,   outputPerMTok: 10.00 },
  'gemini-2.5-flash':            { inputPerMTok: 0.15,   outputPerMTok: 0.60 },
  'gemini-2.0-flash':            { inputPerMTok: 0.10,   outputPerMTok: 0.40 },
  'gemini-1.5-pro':              { inputPerMTok: 1.25,   outputPerMTok: 5.00 },
  'gemini-1.5-flash':            { inputPerMTok: 0.075,  outputPerMTok: 0.30 },

  // ── Groq ──────────────────────────────────────────────
  'llama-3.3-70b-versatile':     { inputPerMTok: 0.59,   outputPerMTok: 0.79 },
  'llama-3.1-8b-instant':        { inputPerMTok: 0.05,   outputPerMTok: 0.08 },
  'mixtral-8x7b-32768':          { inputPerMTok: 0.24,   outputPerMTok: 0.24 },
  'gemma2-9b-it':                { inputPerMTok: 0.20,   outputPerMTok: 0.20 },
};

/**
 * Normalize a model name for matching:
 * - lowercase
 * - replace dots with hyphens (e.g., "3.5" -> "3-5")
 * - strip date suffixes (e.g., "-20250514")
 * - strip "latest" suffix
 */
export function normalizeModelName(model: string): string {
  return model
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

/**
 * Find the best matching price entry for a model name.
 *
 * Strategy:
 * 1. Exact match on normalized name
 * 2. Prefix match (longest wins)
 */
function findPrice(model: string): ModelPrice | null {
  const normalized = normalizeModelName(model);

  // Build a normalized lookup
  const normalizedTable = new Map<string, ModelPrice>();
  for (const [key, price] of Object.entries(PRICE_TABLE)) {
    normalizedTable.set(normalizeModelName(key), price);
  }

  // 1. Exact match
  const exact = normalizedTable.get(normalized);
  if (exact) return exact;

  // 2. Prefix match — longest key wins
  let bestMatch: ModelPrice | null = null;
  let bestLength = 0;

  for (const [key, price] of normalizedTable) {
    if (normalized.startsWith(key) && key.length > bestLength) {
      bestMatch = price;
      bestLength = key.length;
    }
  }

  return bestMatch;
}

/**
 * Calculate the cost in USD for a given model and token counts.
 *
 * @param model - Model name (e.g., "claude-3.5-sonnet-20240620")
 * @param inputTokens - Number of input/prompt tokens
 * @param outputTokens - Number of output/completion tokens
 * @returns Cost in USD. Returns 0 for unknown models (with warning).
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Strip provider prefix (e.g., "gemini-cli/gemini-2.5-flash" → "gemini-2.5-flash")
  const strippedModel = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  const price = findPrice(strippedModel);

  if (!price) {
    logger.warn({ model }, 'Unknown model for pricing — cost defaulting to $0');
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * price.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * price.outputPerMTok;

  return inputCost + outputCost;
}

/**
 * Get the price entry for a model (for display/API purposes).
 * Returns null if the model is not in the pricing table.
 */
export function getModelPrice(model: string): ModelPrice | null {
  return findPrice(model);
}

/**
 * Get the full pricing table (for seeding or display).
 */
export function getPriceTable(): Record<string, ModelPrice> {
  return { ...PRICE_TABLE };
}
