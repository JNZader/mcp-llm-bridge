/**
 * PageIndex Tests
 * 
 * Validate chunking, database, and service functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PageIndexService, PaginationConfig } from '../src/pageindex';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = '/tmp/test-pageindex.db';

const SMALL_MODEL_CONFIG: PaginationConfig = {
  maxTokensPerPage: 1000,  // 1K tokens per page
  overlapTokens: 100,
  summaryTokens: 150
};

describe('PageIndex', () => {
  let service: PageIndexService;

  beforeEach(() => {
    // Clean up
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
    service = new PageIndexService(TEST_DB, SMALL_MODEL_CONFIG);
  });

  afterEach(() => {
    service.close();
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  describe('Basic Pagination', () => {
    it('should paginate long content', async () => {
      const content = 'Word '.repeat(5000); // ~20K chars = ~5K tokens
      
      const result = await service.paginateSession('test-session', content);
      
      expect(result.pages).toBeGreaterThan(1);
      expect(result.tokens).toBeGreaterThan(4000);
    });

    it('should retrieve specific pages', async () => {
      const content = 'Section 1\n\n'.repeat(1000) + 'Section 2\n\n'.repeat(1000);
      
      await service.paginateSession('test-session-2', content);
      
      const page1 = service.getPage('test-session-2', 1);
      const page2 = service.getPage('test-session-2', 2);
      
      expect(page1).toBeDefined();
      expect(page2).toBeDefined();
      expect(page1?.pageNum).toBe(1);
      expect(page2?.pageNum).toBe(2);
    });

    it('should return null for non-existent pages', () => {
      const page = service.getPage('non-existent', 1);
      expect(page).toBeNull();
    });
  });

  describe('Context Window', () => {
    it('should get context window with surrounding pages', async () => {
      const content = Array(10).fill(0).map((_, i) => 
        `Section ${i}\n\n${'Content '.repeat(500)}`
      ).join('\n\n');
      
      await service.paginateSession('context-test', content);
      
      const context = service.getContext({
        sessionId: 'context-test',
        pageNum: 3,
        windowSize: 1
      });
      
      expect(context.totalInContext).toBe(3); // prev + current + next
      expect(context.currentPage.pageNum).toBe(3);
      expect(context.previousPages.length).toBe(1);
      expect(context.nextPages.length).toBe(1);
    });
  });

  describe('Compaction Prevention', () => {
    it('should detect when compaction is needed', async () => {
      const content = 'Word '.repeat(3000); // ~3K tokens
      
      await service.paginateSession('compact-test', content);
      
      // 3K tokens in 4K model -> should not compact
      const safeCheck = service.checkCompaction('compact-test', 4096, 0);
      expect(safeCheck.shouldCompact).toBe(false);
      expect(safeCheck.safeToProceed).toBe(true);
      
      // But adding more might trigger it
      const unsafeCheck = service.checkCompaction('compact-test', 4096, 1500);
      expect(unsafeCheck.shouldCompact).toBe(true);
      expect(unsafeCheck.suggestedAction).toBe('compact');
    });

    it('should recommend pagination for very large content', async () => {
      const content = 'Word '.repeat(10000); // ~10K tokens
      
      await service.paginateSession('large-test', content);
      
      const check = service.checkCompaction('large-test', 4096, 0);
      expect(check.shouldCompact).toBe(true);
    });
  });

  describe('Navigation', () => {
    it('should navigate between pages', async () => {
      const content = Array(5).fill(0).map((_, i) => 
        `Page ${i} content `.repeat(400)
      ).join('\n\n');
      
      await service.paginateSession('nav-test', content);
      
      const next = service.navigate({
        sessionId: 'nav-test',
        currentPageNum: 1,
        direction: 'next'
      });
      
      expect(next?.pageNum).toBe(2);
      
      const prev = service.navigate({
        sessionId: 'nav-test',
        currentPageNum: 2,
        direction: 'prev'
      });
      
      expect(prev?.pageNum).toBe(1);
    });

    it('should return null at boundaries', async () => {
      const content = 'Content '.repeat(1000);
      
      await service.paginateSession('boundary-test', content);
      
      const beforeFirst = service.navigate({
        sessionId: 'boundary-test',
        currentPageNum: 1,
        direction: 'prev'
      });
      
      expect(beforeFirst).toBeNull();
    });
  });

  describe('Page Search', () => {
    it('should find relevant pages by keywords', async () => {
      const content = `
        Authentication and Security
        ${'auth '.repeat(300)}
        
        Database Schema
        ${'database '.repeat(300)}
        
        API Endpoints
        ${'api '.repeat(300)}
      `;
      
      await service.paginateSession('search-test', content);
      
      const relevant = service.findRelevantPages('search-test', 'authentication', 2);
      
      expect(relevant.length).toBeGreaterThan(0);
      expect(relevant[0].content.toLowerCase()).toContain('auth');
    });
  });

  describe('Stats and Info', () => {
    it('should return session info', async () => {
      const content = 'Test '.repeat(2000);
      
      await service.paginateSession('info-test', content);
      
      const info = service.getSessionInfo('info-test');
      
      expect(info.exists).toBe(true);
      expect(info.pages).toBeGreaterThan(0);
      expect(info.tokens).toBeGreaterThan(0);
    });

    it('should return stats', async () => {
      const content = 'Test '.repeat(1000);
      
      await service.paginateSession('stats-test-1', content);
      await service.paginateSession('stats-test-2', content);
      
      const stats = service.getStats();
      
      expect(stats.sessions).toBe(2);
      expect(stats.pages).toBeGreaterThan(0);
    });
  });
});
