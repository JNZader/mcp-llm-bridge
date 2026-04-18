/**
 * PageIndex Chunker
 * 
 * Divides large conversation content into manageable pages
 * optimized for small context windows (4K-8K models).
 */

import { PageChunk, PaginationConfig } from './types.js';

export const DEFAULT_CONFIG: PaginationConfig = {
  maxTokensPerPage: 1500,    // Leaves 2500 tokens for response in 4K model
  overlapTokens: 200,        // Context overlap between pages
  summaryTokens: 200         // Summary for quick reference
};

/**
 * Estima tokens a partir de caracteres
 * 1 token ≈ 4 caracteres (promedio inglés/español)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk content into pages with overlap
 */
export function chunkContent(
  content: string,
  config: PaginationConfig = DEFAULT_CONFIG
): string[] {
  const chunks: string[] = [];
  const maxChars = config.maxTokensPerPage * 4;
  const overlapChars = config.overlapTokens * 4;
  
  let currentPos = 0;
  
  while (currentPos < content.length) {
    // Find good break point (paragraph boundary)
    let endPos = Math.min(currentPos + maxChars, content.length);
    
    if (endPos < content.length) {
      // Try to break at paragraph
      const paragraphBreak = content.lastIndexOf('\n\n', endPos);
      if (paragraphBreak > currentPos + (maxChars * 0.5)) {
        endPos = paragraphBreak + 2;
      } else {
        // Try sentence break
        const sentenceBreak = content.lastIndexOf('. ', endPos);
        if (sentenceBreak > currentPos + (maxChars * 0.7)) {
          endPos = sentenceBreak + 2;
        }
      }
    }
    
    chunks.push(content.slice(currentPos, endPos).trim());
    
    // Move position with overlap
    currentPos = Math.max(currentPos + 1, endPos - overlapChars);
  }
  
  return chunks;
}

/**
 * Generate summary for a chunk (placeholder)
 * In real implementation, this would call LLM to summarize
 */
export async function generateSummary(
  content: string,
  maxTokens: number = 200
): Promise<string> {
  // Simple extraction-based summary for now
  // First sentence + key phrases
  const firstSentence = content.split(/[.!?]\s+/)[0] || content.slice(0, 100);
  const keyPhrases = extractKeyPhrases(content);
  
  return `${firstSentence}. Topics: ${keyPhrases.join(', ')}`.slice(0, maxTokens * 4);
}

/**
 * Extract key phrases from content
 */
function extractKeyPhrases(content: string): string[] {
  const phrases: string[] = [];
  
  // Look for markdown headers
  const headers = content.match(/^#{1,3}\s+(.+)$/gm);
  if (headers) {
    headers.slice(0, 3).forEach(h => {
      phrases.push(h.replace(/^#+\s+/, '').slice(0, 50));
    });
  }
  
  // Look for emphasized text
  const emphasized = content.match(/\*\*(.+?)\*\*/g);
  if (emphasized && phrases.length < 3) {
    emphasized.slice(0, 2).forEach(e => {
      phrases.push(e.replace(/\*\*/g, '').slice(0, 50));
    });
  }
  
  return phrases.slice(0, 4);
}

/**
 * Create page chunks from conversation turns
 */
export function createPageChunks(
  sessionId: string,
  content: string,
  config: PaginationConfig = DEFAULT_CONFIG
): Omit<PageChunk, 'id' | 'summary' | 'createdAt'>[] {
  const chunks = chunkContent(content, config);
  const total = chunks.length;
  
  return chunks.map((content, index) => ({
    sessionId,
    pageNum: index + 1,
    totalPages: total,
    content,
    tokenCount: estimateTokens(content)
  }));
}

/**
 * Calculate if compaction is needed
 */
export function shouldCompact(
  currentTokens: number,
  modelMaxTokens: number,
  safetyMargin: number = 0.3
): CompactionDecision {
  const threshold = modelMaxTokens * (1 - safetyMargin);
  
  return {
    shouldCompact: currentTokens > threshold,
    currentTokens,
    threshold,
    suggestedPages: Math.ceil(currentTokens / (threshold * 0.5))
  };
}

interface CompactionDecision {
  shouldCompact: boolean;
  currentTokens: number;
  threshold: number;
  suggestedPages: number;
}
