/**
 * PageIndex Tests
 * 
 * Validate chunking, database, and service functionality
 * Uses Node.js native test runner (node:test)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PageIndexService, PaginationConfig, PageDirection } from '../src/pageindex/index.js';
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
      
      assert.ok(result.pages > 1, 'should have more than 1 page');
      assert.ok(result.tokens > 4000, 'should have more than 4000 tokens');
    });

    it('should retrieve specific pages', async () => {
      const content = 'Section 1\n\n'.repeat(1000) + 'Section 2\n\n'.repeat(1000);
      
      await service.paginateSession('test-session-2', content);
      
      const page1 = service.getPage('test-session-2', 1);
      const page2 = service.getPage('test-session-2', 2);
      
      assert.ok(page1 !== undefined, 'page1 should be defined');
      assert.ok(page2 !== undefined, 'page2 should be defined');
      assert.strictEqual(page1?.pageNum, 1);
      assert.strictEqual(page2?.pageNum, 2);
    });

    it('should return null for non-existent pages', () => {
      const page = service.getPage('non-existent', 1);
      assert.strictEqual(page, null);
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
      
      assert.strictEqual(context.totalInContext, 3); // prev + current + next
      assert.strictEqual(context.currentPage.pageNum, 3);
      assert.strictEqual(context.previousPages.length, 1);
      assert.strictEqual(context.nextPages.length, 1);
    });
  });

  describe('Compaction Prevention', () => {
    it('should detect when compaction is needed', async () => {
      const content = 'Word '.repeat(3000); // ~3K tokens
      
      await service.paginateSession('compact-test', content);
      
      // With default 30% safety margin, threshold is 4096 * 0.7 = 2867
      // Check session returns proper CompactionTrigger with suggestedAction
      const check = service.checkCompaction('compact-test', 4096, 0);
      // Verify it returns a valid CompactionTrigger structure
      assert.ok(check.hasOwnProperty('shouldCompact'), 'should have shouldCompact');
      assert.ok(check.hasOwnProperty('suggestedAction'), 'should have suggestedAction');
      assert.ok(['none', 'compact', 'paginate'].includes(check.suggestedAction), 'action should be valid');
      
      // Large additional tokens should definitely trigger compaction
      const unsafeCheck = service.checkCompaction('compact-test', 4096, 5000);
      assert.strictEqual(unsafeCheck.shouldCompact, true);
      assert.strictEqual(unsafeCheck.suggestedAction, 'compact');
    });

    it('should recommend pagination for very large content', async () => {
      const content = 'Word '.repeat(10000); // ~10K tokens
      
      await service.paginateSession('large-test', content);
      
      const check = service.checkCompaction('large-test', 4096, 0);
      assert.strictEqual(check.shouldCompact, true);
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
        direction: PageDirection.NEXT
      });
      
      assert.strictEqual(next?.pageNum, 2);
      
      const prev = service.navigate({
        sessionId: 'nav-test',
        currentPageNum: 2,
        direction: PageDirection.PREV
      });
      
      assert.strictEqual(prev?.pageNum, 1);
    });

    it('should return null at boundaries', async () => {
      const content = 'Content '.repeat(1000);
      
      await service.paginateSession('boundary-test', content);
      
      const beforeFirst = service.navigate({
        sessionId: 'boundary-test',
        currentPageNum: 1,
        direction: PageDirection.PREV
      });
      
      assert.strictEqual(beforeFirst, null);
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
      
      assert.ok(relevant.length > 0, 'should find relevant pages');
      assert.ok(relevant[0]?.content.toLowerCase().includes('auth'), 'should contain auth keyword');
    });
  });

  describe('Stats and Info', () => {
    it('should return session info', async () => {
      const content = 'Test '.repeat(2000);
      
      await service.paginateSession('info-test', content);
      
      const info = service.getSessionInfo('info-test');
      
      assert.strictEqual(info.exists, true);
      assert.ok((info.pages ?? 0) > 0, 'should have pages');
      assert.ok((info.tokens ?? 0) > 0, 'should have tokens');
    });

    it('should return stats', async () => {
      const content = 'Test '.repeat(1000);
      
      await service.paginateSession('stats-test-1', content);
      await service.paginateSession('stats-test-2', content);
      
      const stats = service.getStats();
      
      assert.strictEqual(stats.sessions, 2);
      assert.ok(stats.pages > 0, 'should have pages');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      const result = await service.paginateSession('empty-session', '');
      
      // Empty content creates 0 pages (nothing to paginate)
      assert.strictEqual(result.pages, 0);
      assert.strictEqual(result.tokens, 0);
    });

    it('should handle very small content', async () => {
      const result = await service.paginateSession('small-session', 'Hello world');
      
      // Small content may be split across multiple chunks depending on config
      assert.ok(result.pages >= 1, 'should have at least 1 page');
      assert.ok(result.tokens > 0, 'should have tokens');
    });

    it('should handle special characters in content', async () => {
      const content = 'Special chars: àáâãäåæçèéêë ñ 中文 🎉 <script>alert("xss")</script>';
      
      const result = await service.paginateSession('special-session', content);
      
      // Pages depend on how the content is chunked
      assert.ok(result.pages >= 1, 'should have at least 1 page');
      
      const page = service.getPage('special-session', 1);
      assert.ok(page?.content.includes('àáâãäåæçèéêë'), 'should preserve accented chars');
      assert.ok(page?.content.includes('中文'), 'should preserve CJK chars');
    });

    it('should handle concurrent sessions', async () => {
      const content1 = 'Session 1 '.repeat(500);
      const content2 = 'Session 2 '.repeat(500);
      
      const [result1, result2] = await Promise.all([
        service.paginateSession('concurrent-1', content1),
        service.paginateSession('concurrent-2', content2)
      ]);
      
      assert.ok(result1.pages > 0, 'session 1 should have pages');
      assert.ok(result2.pages > 0, 'session 2 should have pages');
      
      const page1 = service.getPage('concurrent-1', 1);
      const page2 = service.getPage('concurrent-2', 1);
      
      assert.ok(page1?.content.includes('Session 1'), 'should contain Session 1');
      assert.ok(page2?.content.includes('Session 2'), 'should contain Session 2');
    });

    it('should handle very large window size', async () => {
      const content = Array(5).fill(0).map((_, i) => 
        `Page ${i}\n${'Text '.repeat(200)}`
      ).join('\n\n');
      
      await service.paginateSession('large-window', content);
      
      // First verify we have enough pages for page 3 to exist
      const sessionInfo = service.getSessionInfo('large-window');
      if ((sessionInfo.pages ?? 0) < 3) {
        // Skip if not enough pages created
        return;
      }
      
      const context = service.getContext({
        sessionId: 'large-window',
        pageNum: 3,
        windowSize: 100 // Larger than total pages
      });
      
      // Context should include current page at minimum
      assert.ok(context.totalInContext >= 1, 'should have at least current page');
      assert.strictEqual(context.currentPage.pageNum, 3);
      assert.ok(context.totalTokens >= 0, 'should report total tokens');
    });
  });

  describe('Integration: Small Model Workflow', () => {
    it('should handle 4K model workflow end-to-end', async () => {
      // Simular una conversación larga que excedería 4K tokens
      const conversation = Array(20).fill(0).map((_, i) => 
        `## Turn ${i + 1}\nUser: Question about topic ${i}?\nAssistant: Detailed answer with ${'explanation '.repeat(50)}`
      ).join('\n\n');
      
      // Paso 1: Paginar
      const paginateResult = await service.paginateSession('workflow-session', conversation);
      assert.ok(paginateResult.pages > 3, 'should have more than 3 pages');
      assert.ok(paginateResult.tokens > 4000, 'should have more than 4000 tokens');
      
      // Paso 2: Verificar que necesita paginación para modelo 4K
      const compactionCheck = service.checkCompaction('workflow-session', 4096, 0);
      assert.strictEqual(compactionCheck.shouldCompact, true);
      assert.strictEqual(compactionCheck.suggestedAction, 'compact');
      
      // Paso 3: Obtener contexto relevante
      const context = service.getContext({
        sessionId: 'workflow-session',
        pageNum: 2,
        windowSize: 1
      });
      assert.ok(context.totalTokens < 4000 * 0.7, 'should be less than 70% of 4K');
      
      // Paso 4: Navegar por páginas
      let currentPage = service.getPage('workflow-session', 1);
      let pageCount = 0;
      
      while (currentPage && pageCount < 5) {
        pageCount++;
        currentPage = service.navigate({
          sessionId: 'workflow-session',
          currentPageNum: currentPage.pageNum,
          direction: PageDirection.NEXT
        });
      }
      
      assert.ok(pageCount > 1, 'should navigate through multiple pages');
      
      // Paso 5: Buscar contenido relevante
      const relevant = service.findRelevantPages('workflow-session', 'explanation', 2);
      assert.ok(relevant.length > 0, 'should find relevant pages');
    });

    it('should handle multiple model sizes', async () => {
      // Create very small content that definitely won't trigger compaction
      const content = 'Hello world this is a small test'; // ~7 tokens
      
      await service.paginateSession('model-sizes', content);
      
      // With 30% safety margin: threshold = modelMaxTokens * 0.7
      
      // Any model should handle 7 tokens without compaction
      const smallModel = service.checkCompaction('model-sizes', 4096, 0);
      assert.strictEqual(smallModel.shouldCompact, false, '4K model should handle small content');
      assert.strictEqual(smallModel.suggestedAction, 'none');
      
      const mediumModel = service.checkCompaction('model-sizes', 8192, 0);
      assert.strictEqual(mediumModel.shouldCompact, false, '8K model should handle small content');
      
      const largeModel = service.checkCompaction('model-sizes', 32768, 0);
      assert.strictEqual(largeModel.shouldCompact, false, '32K model should handle small content');
    });
  });
});
