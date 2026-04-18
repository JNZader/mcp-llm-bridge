/**
 * PageIndex Database Layer
 * 
 * SQLite storage for conversation pages
 * Zero external dependencies
 */

import Database from 'better-sqlite3';
import { PageChunk, ConversationSession } from './types.js';

export class PageIndexDatabase {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        session_id TEXT PRIMARY KEY,
        total_pages INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      )
    `);

    // Pages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        page_num INTEGER NOT NULL,
        total_pages INTEGER NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        token_count INTEGER NOT NULL,
        prev_page_id INTEGER,
        next_page_id INTEGER,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
        FOREIGN KEY (prev_page_id) REFERENCES conversation_pages(id),
        FOREIGN KEY (next_page_id) REFERENCES conversation_pages(id),
        UNIQUE(session_id, page_num)
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pages_session ON conversation_pages(session_id);
      CREATE INDEX IF NOT EXISTS idx_pages_number ON conversation_pages(session_id, page_num);
    `);
  }

  /**
   * Create a new session with paginated content
   */
  createSession(
    sessionId: string,
    pages: Omit<PageChunk, 'id' | 'createdAt'>[]
  ): void {
    const now = Math.floor(Date.now() / 1000);
    const totalTokens = pages.reduce((sum, p) => sum + p.tokenCount, 0);

    // Insert session
    const insertSession = this.db.prepare(`
      INSERT INTO conversation_sessions 
      (session_id, total_pages, total_tokens, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSession.run(sessionId, pages.length, totalTokens, now, now);

    // Insert pages with linking
    const insertPage = this.db.prepare(`
      INSERT INTO conversation_pages
      (session_id, page_num, total_pages, content, summary, token_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const updateLinks = this.db.prepare(`
      UPDATE conversation_pages
      SET prev_page_id = ?, next_page_id = ?
      WHERE id = ?
    `);

    const pageIds: number[] = [];

    for (const page of pages) {
      const result = insertPage.run(
        page.sessionId,
        page.pageNum,
        page.totalPages,
        page.content,
        page.summary || null,
        page.tokenCount
      );
      pageIds.push(result.lastInsertRowid as number);
    }

    // Link pages
    for (let i = 0; i < pageIds.length; i++) {
      const prevId = i > 0 ? pageIds[i - 1] : null;
      const nextId = i < pageIds.length - 1 ? pageIds[i + 1] : null;
      updateLinks.run(prevId, nextId, pageIds[i]);
    }
  }

  /**
   * Get a specific page
   */
  getPage(sessionId: string, pageNum: number): PageChunk | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_pages
      WHERE session_id = ? AND page_num = ?
    `);
    const row = stmt.get(sessionId, pageNum) as any;
    
    if (!row) return null;

    return this.rowToPageChunk(row);
  }

  /**
   * Get pages with surrounding context
   */
  getContextWindow(
    sessionId: string,
    pageNum: number,
    windowSize: number
  ): PageChunk[] {
    const startPage = Math.max(1, pageNum - windowSize);
    const endPage = pageNum + windowSize;

    const stmt = this.db.prepare(`
      SELECT * FROM conversation_pages
      WHERE session_id = ? AND page_num BETWEEN ? AND ?
      ORDER BY page_num
    `);

    const rows = stmt.all(sessionId, startPage, endPage) as any[];
    return rows.map(r => this.rowToPageChunk(r));
  }

  /**
   * Navigate to adjacent page
   */
  navigatePage(
    sessionId: string,
    currentPageNum: number,
    direction: 'next' | 'prev'
  ): PageChunk | null {
    const targetNum = direction === 'next' 
      ? currentPageNum + 1 
      : currentPageNum - 1;

    if (targetNum < 1) return null;

    return this.getPage(sessionId, targetNum);
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): ConversationSession | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_sessions
      WHERE session_id = ?
    `);
    const row = stmt.get(sessionId) as any;
    
    if (!row) return null;

    return {
      sessionId: row.session_id,
      totalPages: row.total_pages,
      totalTokens: row.total_tokens,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed
    };
  }

  /**
   * Update last accessed
   */
  touchSession(sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE conversation_sessions
      SET last_accessed = ?
      WHERE session_id = ?
    `);
    stmt.run(Math.floor(Date.now() / 1000), sessionId);
  }

  /**
   * Delete old sessions
   */
  cleanup(maxAgeDays: number = 7): void {
    const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 24 * 60 * 60);
    
    const stmt = this.db.prepare(`
      DELETE FROM conversation_sessions
      WHERE last_accessed < ?
    `);
    stmt.run(cutoff);
  }

  /**
   * Get total stats
   */
  getStats(): { sessions: number; pages: number } {
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM conversation_sessions').get() as any;
    const pages = this.db.prepare('SELECT COUNT(*) as count FROM conversation_pages').get() as any;
    
    return {
      sessions: sessions.count,
      pages: pages.count
    };
  }

  private rowToPageChunk(row: any): PageChunk {
    return {
      id: row.id,
      sessionId: row.session_id,
      pageNum: row.page_num,
      totalPages: row.total_pages,
      content: row.content,
      summary: row.summary,
      tokenCount: row.token_count,
      prevPageId: row.prev_page_id,
      nextPageId: row.next_page_id,
      createdAt: row.created_at
    };
  }

  close(): void {
    this.db.close();
  }
}
