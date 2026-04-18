import {
  logger
} from "./chunk-WGKIBMFP.js";

// src/pageindex/mcp-integration.ts
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// src/pageindex/chunker.ts
var DEFAULT_CONFIG = {
  maxTokensPerPage: 1500,
  // Leaves 2500 tokens for response in 4K model
  overlapTokens: 200,
  // Context overlap between pages
  summaryTokens: 200
  // Summary for quick reference
};
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function chunkContent(content, config = DEFAULT_CONFIG) {
  const chunks = [];
  const maxChars = config.maxTokensPerPage * 4;
  const overlapChars = config.overlapTokens * 4;
  let currentPos = 0;
  while (currentPos < content.length) {
    let endPos = Math.min(currentPos + maxChars, content.length);
    if (endPos < content.length) {
      const paragraphBreak = content.lastIndexOf("\n\n", endPos);
      if (paragraphBreak > currentPos + maxChars * 0.5) {
        endPos = paragraphBreak + 2;
      } else {
        const sentenceBreak = content.lastIndexOf(". ", endPos);
        if (sentenceBreak > currentPos + maxChars * 0.7) {
          endPos = sentenceBreak + 2;
        }
      }
    }
    chunks.push(content.slice(currentPos, endPos).trim());
    currentPos = Math.max(currentPos + 1, endPos - overlapChars);
  }
  return chunks;
}
async function generateSummary(content, maxTokens = 200) {
  const firstSentence = content.split(/[.!?]\s+/)[0] || content.slice(0, 100);
  const keyPhrases = extractKeyPhrases(content);
  return `${firstSentence}. Topics: ${keyPhrases.join(", ")}`.slice(0, maxTokens * 4);
}
function extractKeyPhrases(content) {
  const phrases = [];
  const headers = content.match(/^#{1,3}\s+(.+)$/gm);
  if (headers) {
    headers.slice(0, 3).forEach((h) => {
      phrases.push(h.replace(/^#+\s+/, "").slice(0, 50));
    });
  }
  const emphasized = content.match(/\*\*(.+?)\*\*/g);
  if (emphasized && phrases.length < 3) {
    emphasized.slice(0, 2).forEach((e) => {
      phrases.push(e.replace(/\*\*/g, "").slice(0, 50));
    });
  }
  return phrases.slice(0, 4);
}
function createPageChunks(sessionId, content, config = DEFAULT_CONFIG) {
  const chunks = chunkContent(content, config);
  const total = chunks.length;
  return chunks.map((content2, index) => ({
    sessionId,
    pageNum: index + 1,
    totalPages: total,
    content: content2,
    tokenCount: estimateTokens(content2)
  }));
}
function shouldCompact(currentTokens, modelMaxTokens, safetyMargin = 0.3) {
  const threshold = modelMaxTokens * (1 - safetyMargin);
  return {
    shouldCompact: currentTokens > threshold,
    currentTokens,
    threshold,
    suggestedPages: Math.ceil(currentTokens / (threshold * 0.5))
  };
}

// src/pageindex/database.ts
import Database from "better-sqlite3";
var PageIndexDatabase = class {
  db;
  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.initTables();
  }
  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        session_id TEXT PRIMARY KEY,
        total_pages INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      )
    `);
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
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pages_session ON conversation_pages(session_id);
      CREATE INDEX IF NOT EXISTS idx_pages_number ON conversation_pages(session_id, page_num);
    `);
  }
  /**
   * Create a new session with paginated content
   */
  createSession(sessionId, pages) {
    const now = Math.floor(Date.now() / 1e3);
    const totalTokens = pages.reduce((sum, p) => sum + p.tokenCount, 0);
    const insertSession = this.db.prepare(`
      INSERT INTO conversation_sessions 
      (session_id, total_pages, total_tokens, created_at, last_accessed)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSession.run(sessionId, pages.length, totalTokens, now, now);
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
    const pageIds = [];
    for (const page of pages) {
      const result = insertPage.run(
        page.sessionId,
        page.pageNum,
        page.totalPages,
        page.content,
        page.summary || null,
        page.tokenCount
      );
      pageIds.push(result.lastInsertRowid);
    }
    for (let i = 0; i < pageIds.length; i++) {
      const prevId = i > 0 ? pageIds[i - 1] : null;
      const nextId = i < pageIds.length - 1 ? pageIds[i + 1] : null;
      updateLinks.run(prevId, nextId, pageIds[i]);
    }
  }
  /**
   * Get a specific page
   */
  getPage(sessionId, pageNum) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_pages
      WHERE session_id = ? AND page_num = ?
    `);
    const row = stmt.get(sessionId, pageNum);
    if (!row) return null;
    return this.rowToPageChunk(row);
  }
  /**
   * Get pages with surrounding context
   */
  getContextWindow(sessionId, pageNum, windowSize) {
    const startPage = Math.max(1, pageNum - windowSize);
    const endPage = pageNum + windowSize;
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_pages
      WHERE session_id = ? AND page_num BETWEEN ? AND ?
      ORDER BY page_num
    `);
    const rows = stmt.all(sessionId, startPage, endPage);
    return rows.map((r) => this.rowToPageChunk(r));
  }
  /**
   * Navigate to adjacent page
   */
  navigatePage(sessionId, currentPageNum, direction) {
    const targetNum = direction === "next" ? currentPageNum + 1 : currentPageNum - 1;
    if (targetNum < 1) return null;
    return this.getPage(sessionId, targetNum);
  }
  /**
   * Get session info
   */
  getSession(sessionId) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_sessions
      WHERE session_id = ?
    `);
    const row = stmt.get(sessionId);
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
  touchSession(sessionId) {
    const stmt = this.db.prepare(`
      UPDATE conversation_sessions
      SET last_accessed = ?
      WHERE session_id = ?
    `);
    stmt.run(Math.floor(Date.now() / 1e3), sessionId);
  }
  /**
   * Delete old sessions
   */
  cleanup(maxAgeDays = 7) {
    const cutoff = Math.floor(Date.now() / 1e3) - maxAgeDays * 24 * 60 * 60;
    const stmt = this.db.prepare(`
      DELETE FROM conversation_sessions
      WHERE last_accessed < ?
    `);
    stmt.run(cutoff);
  }
  /**
   * Get total stats
   */
  getStats() {
    const sessions = this.db.prepare("SELECT COUNT(*) as count FROM conversation_sessions").get();
    const pages = this.db.prepare("SELECT COUNT(*) as count FROM conversation_pages").get();
    return {
      sessions: sessions.count,
      pages: pages.count
    };
  }
  rowToPageChunk(row) {
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
  close() {
    this.db.close();
  }
};

// src/pageindex/service.ts
var PageIndexService = class {
  db;
  config;
  constructor(dbPath, config = DEFAULT_CONFIG) {
    this.db = new PageIndexDatabase(dbPath);
    this.config = config;
  }
  /**
   * Paginate a conversation session
   */
  async paginateSession(sessionId, content) {
    const existing = this.db.getSession(sessionId);
    if (existing) {
      return { pages: existing.totalPages, tokens: existing.totalTokens };
    }
    const chunks = createPageChunks(sessionId, content, this.config);
    const pagesWithSummary = await Promise.all(
      chunks.map(async (chunk) => ({
        ...chunk,
        summary: await generateSummary(chunk.content, this.config.summaryTokens)
      }))
    );
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
  getPage(sessionId, pageNum) {
    this.db.touchSession(sessionId);
    return this.db.getPage(sessionId, pageNum);
  }
  /**
   * Get page with context window
   */
  getContext(request) {
    const { sessionId, pageNum, windowSize } = request;
    this.db.touchSession(sessionId);
    const currentPage = this.db.getPage(sessionId, pageNum);
    if (!currentPage) {
      throw new Error(`Page ${pageNum} not found in session ${sessionId}`);
    }
    const contextPages = this.db.getContextWindow(sessionId, pageNum, windowSize);
    const previousPages = contextPages.filter((p) => p.pageNum < pageNum);
    const nextPages = contextPages.filter((p) => p.pageNum > pageNum);
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
  navigate(request) {
    const { sessionId, currentPageNum, direction } = request;
    this.db.touchSession(sessionId);
    switch (direction) {
      case "next" /* NEXT */:
        return this.db.navigatePage(sessionId, currentPageNum, "next");
      case "prev" /* PREV */:
        return this.db.navigatePage(sessionId, currentPageNum, "prev");
      case "first" /* FIRST */:
        return this.db.getPage(sessionId, 1);
      case "last" /* LAST */:
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
  checkCompaction(sessionId, modelMaxTokens, additionalTokens = 0) {
    const session = this.db.getSession(sessionId);
    if (!session) {
      return {
        currentTokens: additionalTokens,
        maxTokens: modelMaxTokens,
        sessionId,
        shouldCompact: false,
        suggestedAction: "none"
      };
    }
    const currentTokens = session.totalTokens + additionalTokens;
    const decision = shouldCompact(currentTokens, modelMaxTokens);
    let suggestedAction = "none";
    if (decision.shouldCompact) {
      suggestedAction = session.totalPages > 1 ? "compact" : "paginate";
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
  findRelevantPages(sessionId, query, maxPages = 2) {
    const session = this.db.getSession(sessionId);
    if (!session) return [];
    const keywords = query.toLowerCase().split(/\s+/);
    const allPages = [];
    for (let i = 1; i <= session.totalPages; i++) {
      const page = this.db.getPage(sessionId, i);
      if (!page) continue;
      const content = (page.content + " " + (page.summary || "")).toLowerCase();
      const score = keywords.reduce((sum, kw) => {
        const matches = (content.match(new RegExp(kw, "g")) || []).length;
        return sum + matches;
      }, 0);
      if (score > 0) {
        allPages.push({ ...page, score });
      }
    }
    return allPages.sort((a, b) => b.score - a.score).slice(0, maxPages).map(({ score, ...page }) => page);
  }
  /**
   * Get session info
   */
  getSessionInfo(sessionId) {
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
  cleanup(maxAgeDays = 7) {
    this.db.cleanup(maxAgeDays);
  }
  /**
   * Get stats
   */
  getStats() {
    return this.db.getStats();
  }
  close() {
    this.db.close();
  }
};

// src/pageindex/tools.ts
var PageIndexTools = class {
  service;
  constructor(service) {
    this.service = service;
  }
  /**
   * Tool definitions for MCP
   */
  getToolDefinitions() {
    return [
      {
        name: "conversation_paginate",
        description: "Divide a long conversation into navigable pages. Use this when conversation exceeds safe context limits.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Unique session identifier"
            },
            content: {
              type: "string",
              description: "Full conversation content to paginate"
            }
          },
          required: ["session_id", "content"]
        }
      },
      {
        name: "conversation_get_page",
        description: "Get a specific page from a paginated conversation",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier"
            },
            page_num: {
              type: "number",
              description: "Page number (1-based)"
            }
          },
          required: ["session_id", "page_num"]
        }
      },
      {
        name: "conversation_context",
        description: "Get a page with surrounding context pages. Use this for reading with context.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier"
            },
            page_num: {
              type: "number",
              description: "Target page number"
            },
            window_size: {
              type: "number",
              description: "Number of pages before and after (default: 1)",
              default: 1
            }
          },
          required: ["session_id", "page_num"]
        }
      },
      {
        name: "conversation_navigate",
        description: "Navigate to next, previous, first, or last page",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier"
            },
            current_page_num: {
              type: "number",
              description: "Current page number"
            },
            direction: {
              type: "string",
              enum: ["next", "prev", "first", "last"],
              description: "Navigation direction"
            }
          },
          required: ["session_id", "current_page_num", "direction"]
        }
      },
      {
        name: "conversation_info",
        description: "Get info about a paginated conversation: total pages, total tokens, etc.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier"
            }
          },
          required: ["session_id"]
        }
      },
      {
        name: "conversation_find_relevant",
        description: "Find pages relevant to a query using keyword matching",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier"
            },
            query: {
              type: "string",
              description: "Search query (keywords)"
            },
            max_pages: {
              type: "number",
              description: "Maximum pages to return (default: 2)",
              default: 2
            }
          },
          required: ["session_id", "query"]
        }
      },
      {
        name: "conversation_check_compaction",
        description: "Check if conversation needs compaction for given model context limit",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session identifier"
            },
            model_max_tokens: {
              type: "number",
              description: "Model context window size (e.g., 4096)"
            },
            additional_tokens: {
              type: "number",
              description: "Additional tokens to be added (default: 0)",
              default: 0
            }
          },
          required: ["session_id", "model_max_tokens"]
        }
      }
    ];
  }
  /**
   * Handle tool calls
   */
  async handleToolCall(name, args) {
    switch (name) {
      case "conversation_paginate":
        return this.paginate(args);
      case "conversation_get_page":
        return this.getPage(args);
      case "conversation_context":
        return this.getContext(args);
      case "conversation_navigate":
        return this.navigate(args);
      case "conversation_info":
        return this.getInfo(args);
      case "conversation_find_relevant":
        return this.findRelevant(args);
      case "conversation_check_compaction":
        return this.checkCompaction(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
  async paginate(args) {
    const { session_id, content } = args;
    const result = await this.service.paginateSession(session_id, content);
    return {
      success: true,
      session_id,
      total_pages: result.pages,
      total_tokens: result.tokens,
      message: `Conversation paginated into ${result.pages} pages (${result.tokens} tokens total)`
    };
  }
  getPage(args) {
    const { session_id, page_num } = args;
    const page = this.service.getPage(session_id, page_num);
    if (!page) {
      return {
        success: false,
        error: `Page ${page_num} not found in session ${session_id}`
      };
    }
    return {
      success: true,
      page: {
        page_num: page.pageNum,
        total_pages: page.totalPages,
        content: page.content,
        summary: page.summary,
        token_count: page.tokenCount,
        has_prev: !!page.prevPageId,
        has_next: !!page.nextPageId
      }
    };
  }
  getContext(args) {
    const { session_id, page_num, window_size = 1 } = args;
    try {
      const context = this.service.getContext({
        sessionId: session_id,
        pageNum: page_num,
        windowSize: window_size
      });
      return {
        success: true,
        current_page: context.currentPage.pageNum,
        total_in_context: context.totalInContext,
        total_tokens: context.totalTokens,
        pages: [
          ...context.previousPages.map((p) => ({
            page_num: p.pageNum,
            content: p.content,
            context_type: "PREV"
          })),
          {
            page_num: context.currentPage.pageNum,
            content: context.currentPage.content,
            context_type: "CURRENT"
          },
          ...context.nextPages.map((p) => ({
            page_num: p.pageNum,
            content: p.content,
            context_type: "NEXT"
          }))
        ]
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  navigate(args) {
    const { session_id, current_page_num, direction } = args;
    const page = this.service.navigate({
      sessionId: session_id,
      currentPageNum: current_page_num,
      direction
    });
    if (!page) {
      return {
        success: false,
        error: `Cannot navigate ${direction} from page ${current_page_num}`
      };
    }
    return {
      success: true,
      page: {
        page_num: page.pageNum,
        total_pages: page.totalPages,
        content: page.content,
        has_prev: !!page.prevPageId,
        has_next: !!page.nextPageId
      },
      direction
    };
  }
  getInfo(args) {
    const { session_id } = args;
    const info = this.service.getSessionInfo(session_id);
    if (!info.exists) {
      return {
        success: false,
        exists: false,
        message: `Session ${session_id} not found`
      };
    }
    return {
      success: true,
      exists: true,
      session_id,
      total_pages: info.pages,
      total_tokens: info.tokens,
      created_at: info.createdAt
    };
  }
  findRelevant(args) {
    const { session_id, query, max_pages = 2 } = args;
    const pages = this.service.findRelevantPages(session_id, query, max_pages);
    return {
      success: true,
      session_id,
      query,
      found_pages: pages.length,
      pages: pages.map((p) => ({
        page_num: p.pageNum,
        content: p.content,
        summary: p.summary
      }))
    };
  }
  checkCompaction(args) {
    const { session_id, model_max_tokens, additional_tokens = 0 } = args;
    const trigger = this.service.checkCompaction(
      session_id,
      model_max_tokens,
      additional_tokens
    );
    return {
      success: true,
      session_id,
      current_tokens: trigger.currentTokens,
      max_tokens: trigger.maxTokens,
      should_compact: trigger.shouldCompact,
      suggested_action: trigger.suggestedAction,
      safe_to_proceed: !trigger.shouldCompact,
      message: trigger.shouldCompact ? `WARNING: Context ${trigger.currentTokens} exceeds safe limit for ${model_max_tokens} model. Suggested action: ${trigger.suggestedAction}` : `OK: Context ${trigger.currentTokens} is safe for ${model_max_tokens} model`
    };
  }
};

// src/pageindex/index.ts
function createPageIndex(dbPath) {
  const service = new PageIndexService(dbPath);
  const tools = new PageIndexTools(service);
  return {
    service,
    tools,
    toolDefinitions: tools.getToolDefinitions(),
    handleToolCall: (name, args) => tools.handleToolCall(name, args)
  };
}

// src/pageindex/mcp-integration.ts
function wrapWithPageIndex(server, dbPath) {
  const pageIndex = createPageIndex(dbPath);
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: pageIndex.toolDefinitions
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name.startsWith("conversation_")) {
      try {
        const result = await pageIndex.handleToolCall(name, args ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: !result.success
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, tool: name }, "PageIndex tool error");
        return {
          content: [{ type: "text", text: JSON.stringify({ error: message }) }],
          isError: true
        };
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "Tool not handled by PageIndex" }) }],
      isError: true
    };
  });
  logger.info("PageIndex MCP integration active \u2014 7 conversation tools available");
}
export {
  wrapWithPageIndex
};
