/**
 * PageIndex Types for MCP-LLM-Bridge
 * 
 * Provides type definitions for conversational page indexing
 * to handle large context windows with small models.
 */

export interface PageChunk {
  id?: number;
  sessionId: string;
  pageNum: number;
  totalPages: number;
  content: string;
  summary?: string;           // 200 token summary for quick reference
  tokenCount: number;
  prevPageId?: number;
  nextPageId?: number;
  createdAt: number;
}

export interface ConversationSession {
  sessionId: string;
  totalPages: number;
  totalTokens: number;
  createdAt: number;
  lastAccessed: number;
}

export interface PaginationConfig {
  maxTokensPerPage: number;   // Default: 1500 (leaves room for response)
  overlapTokens: number;      // Default: 200 (context between pages)
  summaryTokens: number;      // Default: 200
}

export interface PageContextRequest {
  sessionId: string;
  pageNum: number;
  windowSize: number;         // Pages before and after
}

export interface PageContextResponse {
  currentPage: PageChunk;
  previousPages: PageChunk[];
  nextPages: PageChunk[];
  totalInContext: number;
  totalTokens: number;
}

export interface CompactionTrigger {
  currentTokens: number;
  maxTokens: number;
  sessionId: string;
  shouldCompact: boolean;
  suggestedAction: 'compact' | 'paginate' | 'none';
}

export enum PageDirection {
  NEXT = 'next',
  PREV = 'prev',
  FIRST = 'first',
  LAST = 'last'
}

export interface PageNavigationRequest {
  sessionId: string;
  currentPageNum: number;
  direction: PageDirection;
}
