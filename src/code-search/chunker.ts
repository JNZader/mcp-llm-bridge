/**
 * Semantic code chunker.
 *
 * Splits source files into meaningful chunks (functions, classes,
 * interfaces, blocks) using regex-based heuristics. No AST required.
 */

import type { CodeChunk, ChunkKind } from './types.js';

/**
 * Pattern definition for extracting code chunks.
 * Each pattern matches a specific code construct.
 */
interface ChunkPattern {
  kind: ChunkKind;
  /** Regex that matches the start of a chunk. Must capture the symbol name in group 1. */
  pattern: RegExp;
}

/**
 * Language-specific chunk patterns.
 * Uses regex heuristics — intentionally simple, not AST-accurate.
 */
const TS_PATTERNS: ChunkPattern[] = [
  // Export/async function declarations
  { kind: 'function', pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m },
  // Arrow function assigned to const/let/var
  { kind: 'function', pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/m },
  // Class declarations
  { kind: 'class', pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
  // Interface declarations
  { kind: 'interface', pattern: /^(?:export\s+)?interface\s+(\w+)/m },
  // Type alias declarations
  { kind: 'type', pattern: /^(?:export\s+)?type\s+(\w+)\s*=/m },
];

const PY_PATTERNS: ChunkPattern[] = [
  { kind: 'function', pattern: /^(?:async\s+)?def\s+(\w+)/m },
  { kind: 'class', pattern: /^class\s+(\w+)/m },
];

const GO_PATTERNS: ChunkPattern[] = [
  { kind: 'function', pattern: /^func\s+(?:\([^)]+\)\s+)?(\w+)/m },
  { kind: 'type', pattern: /^type\s+(\w+)\s+(?:struct|interface)/m },
];

const RUST_PATTERNS: ChunkPattern[] = [
  { kind: 'function', pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/m },
  { kind: 'type', pattern: /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/m },
];

/**
 * Detect the language patterns to use based on file extension.
 */
function getPatternsForFile(filePath: string): ChunkPattern[] {
  if (/\.[jt]sx?$|\.mjs$|\.cjs$/.test(filePath)) return TS_PATTERNS;
  if (/\.py$/.test(filePath)) return PY_PATTERNS;
  if (/\.go$/.test(filePath)) return GO_PATTERNS;
  if (/\.rs$/.test(filePath)) return RUST_PATTERNS;
  // Fallback: try TypeScript patterns (works for many C-family languages)
  return TS_PATTERNS;
}

/**
 * Find the end of a brace-delimited block starting from a given position.
 * Returns the index of the closing brace, or end of content.
 */
function findBlockEnd(content: string, startIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    // Track string boundaries
    if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
      inString = ch;
      continue;
    }
    if (inString === ch) {
      inString = null;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return content.length - 1;
}

/**
 * Find the end of an indentation-delimited block (Python).
 * Returns the 0-based line index of the last line in the block.
 */
function findIndentBlockEnd(lines: string[], startLineIdx: number): number {
  const startLine = lines[startLineIdx];
  if (!startLine) return startLineIdx;

  // Measure base indentation of the def/class line
  const baseIndent = startLine.search(/\S/);

  for (let i = startLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip empty lines
    if (line.trim() === '') continue;
    const indent = line.search(/\S/);
    // If we find a line at same or lesser indentation, block ended at previous line
    if (indent <= baseIndent) {
      // Walk back over empty lines
      let end = i - 1;
      while (end > startLineIdx && lines[end]!.trim() === '') end--;
      return end;
    }
  }

  // Reached end of file
  let end = lines.length - 1;
  while (end > startLineIdx && lines[end]!.trim() === '') end--;
  return end;
}

/**
 * Split a source file into semantic code chunks.
 *
 * @param filePath - Path of the source file (used for language detection).
 * @param content - Raw file content.
 * @returns Array of extracted code chunks.
 */
export function splitIntoChunks(filePath: string, content: string): CodeChunk[] {
  const patterns = getPatternsForFile(filePath);
  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];
  const seen = new Set<string>();
  const isPython = /\.py$/.test(filePath);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    for (const { kind, pattern } of patterns) {
      const match = pattern.exec(line);
      if (!match) continue;

      const name = match[1] ?? 'anonymous';
      let endLineIdx: number;

      if (isPython) {
        endLineIdx = findIndentBlockEnd(lines, lineIdx);
      } else {
        // Find the first opening brace on or after this line
        const lineOffset = lines.slice(0, lineIdx).join('\n').length + (lineIdx > 0 ? 1 : 0);
        const braceIdx = content.indexOf('{', lineOffset);
        if (braceIdx === -1) {
          // No brace — single line (type alias, etc.)
          endLineIdx = lineIdx;
          // Check for multi-line: find semicolon or end
          for (let j = lineIdx; j < lines.length; j++) {
            if (lines[j]!.includes(';') || lines[j]!.trimEnd().endsWith(',')) {
              endLineIdx = j;
              break;
            }
            // If next line starts a new declaration, stop
            if (j > lineIdx && lines[j]!.match(/^(?:export|const|let|var|function|class|interface|type|import)\b/)) {
              endLineIdx = j - 1;
              break;
            }
            endLineIdx = j;
          }
        } else {
          const endIdx = findBlockEnd(content, braceIdx);
          // Convert char index to line number
          endLineIdx = content.substring(0, endIdx + 1).split('\n').length - 1;
        }
      }

      // Clamp to file bounds
      endLineIdx = Math.min(endLineIdx, lines.length - 1);

      const chunkContent = lines.slice(lineIdx, endLineIdx + 1).join('\n');
      const id = `${filePath}:${lineIdx + 1}`;

      // Avoid duplicate chunks at same location
      if (!seen.has(id)) {
        seen.add(id);
        chunks.push({
          id,
          filePath,
          name,
          kind,
          content: chunkContent,
          startLine: lineIdx + 1,
          endLine: endLineIdx + 1,
        });
      }

      break; // Only match first pattern per line
    }
  }

  return chunks;
}
