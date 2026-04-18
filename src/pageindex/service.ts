/**
 * PageIndex Service
 * 
 * Business logic for conversational page indexing
 * Prevents compaction loops with small models
 */

import { PageIndexDatabase } from './database.js';
import { 
  PageChunk, 
  PageContextRequest, 
  PageContextResponse,
  PageNavigationRequest,
  PageDirection,
  PaginationConfig,
  CompactionTrigger
} from './types.js';
import { 
  createPageChunks, 
  shouldCompact,
  generateSummary,
  DEFAULT_CONFIG 
} from './chunker.js';

export class PageIndexService {
  private db: PageIndexDatabase;
  private config: PaginationConfig;

  constructor(dbPath?: string, config: PaginationConfig = DEFAULT_CONFIG) {
    this.db = new PageIndexDatabase(dbPath);
    this.config = config;
  }

  /**
   * Paginate a conversation session
   */
  async paginateSession(
    sessionId: string,
    content: string
  ): Promise<{ pages: number; tokens: number }> {
    // Check if already paginated
    const existing = this.db.getSession(sessionId);
    if (existing) {
      return { pages: existing.totalPages, tokens: existing.totalTokens };
    }

    // Create chunks
    const chunks = createPageChunks(sessionId, content, this.config);
    
    // Generate summaries for each chunk
    const pagesWithSummary = await Promise.all(
      chunks.map(async (chunk) => ({
        ...chunk,
        summary: await generateSummary(chunk.content, this.config.summaryTokens)
      }))
    );

    // Store in database
    this.db.createSession(sessionId, pagesWithSummary);

    const totalTokens = pagesWithSummary.reduce((sum, p) => sum + p.tokenCount, 0);
    
    return {
      pages: pagesWithSummary.length,
      tokens: totalTokens
    };
  }

  /**
   * Get a specific page
   */
  getPage(sessionId: string, pageNum: number): PageChunk | null {
    this.db.touchSession(sessionId);
    return this.db.getPage(sessionId, pageNum);
  }

  /**
   * Get page with context window
   */
  getContext(request: PageContextRequest): PageContextResponse {
    const { sessionId, pageNum, windowSize } = request;
    
    this.db.touchSession(sessionId);

    const currentPage = this.db.getPage(sessionId, pageNum);
    if (!currentPage) {
      throw new Error(`Page ${pageNum} not found in session ${sessionId}`);
    }

    const contextPages = this.db.getContextWindow(sessionId, pageNum, windowSize);
    
    const previousPages = contextPages.filter(p => p.pageNum < pageNum);
    const nextPages = contextPages.filter(p => p.pageNum > pageNum);
    
    const totalInContext = contextPages.length;
    const totalTokens = contextPages.reduce((sum, p) => sum + p.tokenCount, 0);

    return {
      currentPage,
      previousPages,
      nextPages,
      totalInContext,
      totalTokens
    };
  }

  /**
   * Navigate to another page
   */
  navigate(request: PageNavigationRequest): PageChunk | null {
    const { sessionId, currentPageNum, direction } = request;
    
    this.db.touchSession(sessionId);

    switch (direction) {
      case PageDirection.NEXT:
        return this.db.navigatePage(sessionId, currentPageNum, 'next');
      case PageDirection.PREV:
        return this.db.navigatePage(sessionId, currentPageNum, 'prev');
      case PageDirection.FIRST:
        return this.db.getPage(sessionId, 1);
      case PageDirection.LAST:
        const session = this.db.getSession(sessionId);
        if (!session) return null;
        return this.db.getPage(sessionId, session.totalPages);
      default:
        return null;
    }
  }

  /**
   * Check if compaction is needed
   * Key method to prevent compaction loops
   */
  checkCompaction(
    sessionId: string,
    modelMaxTokens: number,
    additionalTokens: number = 0
  ): CompactionTrigger {
    const session = this.db.getSession(sessionId);
    if (!session) {
      return {
        currentTokens: additionalTokens,
        maxTokens: modelMaxTokens,
        sessionId,
        shouldCompact: false,
        suggestedAction: 'none'
      };
    }

    const currentTokens = session.totalTokens + additionalTokens;
    const decision = shouldCompact(currentTokens, modelMaxTokens);

    let suggestedAction: 'compact' | 'paginate' | 'none' = 'none';
    
    if (decision.shouldCompact) {
      suggestedAction = session.totalPages > 1 ? 'compact' : 'paginate';
    }

    return {
      currentTokens,
      maxTokens: modelMaxTokens,
      sessionId,
      shouldCompact: decision.shouldCompact,
      suggestedAction
    };
  }

  /**
   * Get recommended pages for a query
   * Simple keyword matching (no embeddings)
   */
  findRelevantPages(
    sessionId: string,
    query: string,
    maxPages: number = 2
  ): PageChunk[] {
    const session = this.db.getSession(sessionId);
    if (!session) return [];

    const keywords = query.toLowerCase().split(/\s+/);
    const allPages: Array<PageChunk & { score: number }> = [];

    // Simple keyword scoring
    for (let i = 1; i <= session.totalPages; i++) {
      const page = this.db.getPage(sessionId, i);
      if (!page) continue;

      const content = (page.content + ' ' + (page.summary || '')).toLowerCase();
      const score = keywords.reduce((sum, kw) => {
        const matches = (content.match(new RegExp(kw, 'g')) || []).length;
        return sum + matches;
      }, 0);

      if (score > 0) {
        allPages.push({ ...page, score });
      }
    }

    // Sort by score and return top N
    return allPages
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPages)
      .map(({ score, ...page }) => page);
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId: string): { 
    exists: boolean; 
    pages?: number; 
    tokens?: number;
    createdAt?: number;
  } {
    const session = this.db.getSession(sessionId);
    if (!session) {
      return { exists: false };
    }

    return {
      exists: true,
      pages: session.totalPages,
      tokens: session.totalTokens,
      createdAt: session.createdAt
    };
  }

  /**
   * Cleanup old sessions
   */
  cleanup(maxAgeDays: number = 7): void {
    this.db.cleanup(maxAgeDays);
  }

  /**
   * Get stats
   */
  getStats(): { sessions: number; pages: number } {
    return this.db.getStats();
  }

  close(): void {
    this.db.close();
  }
}
