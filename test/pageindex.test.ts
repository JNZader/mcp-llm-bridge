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

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      const result = await service.paginateSession('empty-session', '');
      
      expect(result.pages).toBe(1);
      expect(result.tokens).toBe(0);
    });

    it('should handle very small content', async () => {
      const result = await service.paginateSession('small-session', 'Hello world');
      
      expect(result.pages).toBe(1);
      expect(result.tokens).toBeGreaterThan(0);
    });

    it('should handle special characters in content', async () => {
      const content = 'Special chars: àáâãäåæçèéêë ñ 中文 🎉 <script>alert("xss")</script>';
      
      const result = await service.paginateSession('special-session', content);
      
      expect(result.pages).toBe(1);
      
      const page = service.getPage('special-session', 1);
      expect(page?.content).toContain('àáâãäåæçèéêë');
      expect(page?.content).toContain('中文');
    });

    it('should handle concurrent sessions', async () => {
      const content1 = 'Session 1 '.repeat(500);
      const content2 = 'Session 2 '.repeat(500);
      
      const [result1, result2] = await Promise.all([
        service.paginateSession('concurrent-1', content1),
        service.paginateSession('concurrent-2', content2)
      ]);
      
      expect(result1.pages).toBeGreaterThan(0);
      expect(result2.pages).toBeGreaterThan(0);
      
      const page1 = service.getPage('concurrent-1', 1);
      const page2 = service.getPage('concurrent-2', 1);
      
      expect(page1?.content).toContain('Session 1');
      expect(page2?.content).toContain('Session 2');
    });

    it('should handle very large window size', async () => {
      const content = Array(5).fill(0).map((_, i) => 
        `Page ${i}\n${'Text '.repeat(200)}`
      ).join('\n\n');
      
      await service.paginateSession('large-window', content);
      
      const context = service.getContext({
        sessionId: 'large-window',
        pageNum: 3,
        windowSize: 100 // Larger than total pages
      });
      
      expect(context.totalInContext).toBeLessThanOrEqual(5);
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
      expect(paginateResult.pages).toBeGreaterThan(3);
      expect(paginateResult.tokens).toBeGreaterThan(4000);
      
      // Paso 2: Verificar que necesita paginación para modelo 4K
      const compactionCheck = service.checkCompaction('workflow-session', 4096, 0);
      expect(compactionCheck.shouldCompact).toBe(true);
      expect(compactionCheck.suggestedAction).toBe('compact');
      
      // Paso 3: Obtener contexto relevante
      const context = service.getContext({
        sessionId: 'workflow-session',
        pageNum: 2,
        windowSize: 1
      });
      expect(context.totalTokens).toBeLessThan(4000 * 0.7); // Menos del 70%
      
      // Paso 4: Navegar por páginas
      let currentPage = service.getPage('workflow-session', 1);
      let pageCount = 0;
      
      while (currentPage && pageCount < 5) {
        pageCount++;
        currentPage = service.navigate({
          sessionId: 'workflow-session',
          currentPageNum: currentPage.pageNum,
          direction: 'next'
        });
      }
      
      expect(pageCount).toBeGreaterThan(1);
      
      // Paso 5: Buscar contenido relevante
      const relevant = service.findRelevantPages('workflow-session', 'explanation', 2);
      expect(relevant.length).toBeGreaterThan(0);
    });

    it('should handle multiple model sizes', async () => {
      const content = 'Word '.repeat(8000); // ~32K chars = ~8K tokens
      
      await service.paginateSession('model-sizes', content);
      
      // 4K model (pequeño) - debería necesitar paginación
      const smallModel = service.checkCompaction('model-sizes', 4096, 0);
      expect(smallModel.shouldCompact).toBe(true);
      
      // 8K model (mediano) - debería necesitar paginación
      const mediumModel = service.checkCompaction('model-sizes', 8192, 0);
      expect(mediumModel.shouldCompact).toBe(true);
      
      // 32K model (grande) - no debería necesitar paginación
      const largeModel = service.checkCompaction('model-sizes', 32768, 0);
      expect(largeModel.shouldCompact).toBe(false);
    });
  });
});
