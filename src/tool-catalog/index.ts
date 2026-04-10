/**
 * Unified tool catalog — aggregates tools from MCP, OpenAPI, GraphQL,
 * and custom sources into a single discoverable registry with
 * intent-based keyword search.
 */

// ── Types ──

export type ToolSource = 'mcp' | 'openapi' | 'graphql' | 'custom';

export interface ToolInput {
  name: string;
  source: ToolSource;
  description: string;
  parameters: Record<string, unknown>;
  tags: string[];
}

export interface ToolEntry extends ToolInput {
  namespace: string; // source:name
  addedAt: string;
}

// ── Catalog ──

export class ToolCatalog {
  private tools: Map<string, ToolEntry> = new Map();

  get size(): number {
    return this.tools.size;
  }

  // ── Registration ──

  register(input: ToolInput, force = false): ToolEntry {
    const namespace = `${input.source}:${input.name}`;

    if (!force && this.tools.has(namespace)) {
      throw new Error(`Tool "${namespace}" already registered. Use force=true to overwrite.`);
    }

    const entry: ToolEntry = {
      ...input,
      namespace,
      addedAt: new Date().toISOString(),
    };

    this.tools.set(namespace, entry);
    return entry;
  }

  registerBulk(inputs: ToolInput[], force = false): ToolEntry[] {
    return inputs.map((input) => this.register(input, force));
  }

  remove(nameOrNamespace: string): boolean {
    // Try exact namespace first
    if (this.tools.has(nameOrNamespace)) {
      this.tools.delete(nameOrNamespace);
      return true;
    }
    return false;
  }

  // ── Lookup ──

  getByName(nameOrNamespace: string): ToolEntry | null {
    // Exact namespace match
    if (this.tools.has(nameOrNamespace)) {
      return this.tools.get(nameOrNamespace)!;
    }

    // Bare name — search across all sources
    for (const entry of this.tools.values()) {
      if (entry.name === nameOrNamespace) {
        return entry;
      }
    }

    return null;
  }

  listAll(sourceFilter?: ToolSource): ToolEntry[] {
    const entries = [...this.tools.values()];
    if (sourceFilter) {
      return entries.filter((e) => e.source === sourceFilter);
    }
    return entries;
  }

  // ── Search ──

  search(query: string, limit = 10): ToolEntry[] {
    if (!query.trim()) return [];

    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ entry: ToolEntry; score: number }> = [];

    for (const entry of this.tools.values()) {
      const score = this._scoreMatch(entry, keywords);
      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  private _scoreMatch(entry: ToolEntry, keywords: string[]): number {
    let score = 0;
    const nameLower = entry.name.toLowerCase();
    const descLower = entry.description.toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());

    for (const kw of keywords) {
      // Name match (highest weight)
      if (nameLower.includes(kw)) {
        score += 3;
      }
      // Tag match
      if (tagsLower.some((t) => t.includes(kw))) {
        score += 2;
      }
      // Description match
      if (descLower.includes(kw)) {
        score += 1;
      }
    }

    return score;
  }

  // ── Serialization ──

  toJSON(): string {
    const entries = [...this.tools.values()];
    return JSON.stringify(entries);
  }

  static fromJSON(json: string): ToolCatalog {
    const entries = JSON.parse(json) as ToolEntry[];
    const catalog = new ToolCatalog();
    for (const entry of entries) {
      catalog.tools.set(entry.namespace, entry);
    }
    return catalog;
  }
}
