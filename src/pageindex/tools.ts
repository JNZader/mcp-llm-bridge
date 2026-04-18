/**
 * PageIndex MCP Tools
 * 
 * Exposes PageIndex functionality to MCP agents
 * Tools: conversation_paginate, conversation_get_page, conversation_context
 */

import { PageIndexService } from './service.js';
import { PageDirection } from './types.js';

export class PageIndexTools {
  private service: PageIndexService;

  constructor(service: PageIndexService) {
    this.service = service;
  }

  /**
   * Tool definitions for MCP
   */
  getToolDefinitions() {
    return [
      {
        name: 'conversation_paginate',
        description: 'Divide a long conversation into navigable pages. Use this when conversation exceeds safe context limits.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Unique session identifier'
            },
            content: {
              type: 'string',
              description: 'Full conversation content to paginate'
            }
          },
          required: ['session_id', 'content']
        }
      },
      {
        name: 'conversation_get_page',
        description: 'Get a specific page from a paginated conversation',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session identifier'
            },
            page_num: {
              type: 'number',
              description: 'Page number (1-based)'
            }
          },
          required: ['session_id', 'page_num']
        }
      },
      {
        name: 'conversation_context',
        description: 'Get a page with surrounding context pages. Use this for reading with context.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session identifier'
            },
            page_num: {
              type: 'number',
              description: 'Target page number'
            },
            window_size: {
              type: 'number',
              description: 'Number of pages before and after (default: 1)',
              default: 1
            }
          },
          required: ['session_id', 'page_num']
        }
      },
      {
        name: 'conversation_navigate',
        description: 'Navigate to next, previous, first, or last page',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session identifier'
            },
            current_page_num: {
              type: 'number',
              description: 'Current page number'
            },
            direction: {
              type: 'string',
              enum: ['next', 'prev', 'first', 'last'],
              description: 'Navigation direction'
            }
          },
          required: ['session_id', 'current_page_num', 'direction']
        }
      },
      {
        name: 'conversation_info',
        description: 'Get info about a paginated conversation: total pages, total tokens, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session identifier'
            }
          },
          required: ['session_id']
        }
      },
      {
        name: 'conversation_find_relevant',
        description: 'Find pages relevant to a query using keyword matching',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session identifier'
            },
            query: {
              type: 'string',
              description: 'Search query (keywords)'
            },
            max_pages: {
              type: 'number',
              description: 'Maximum pages to return (default: 2)',
              default: 2
            }
          },
          required: ['session_id', 'query']
        }
      },
      {
        name: 'conversation_check_compaction',
        description: 'Check if conversation needs compaction for given model context limit',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session identifier'
            },
            model_max_tokens: {
              type: 'number',
              description: 'Model context window size (e.g., 4096)'
            },
            additional_tokens: {
              type: 'number',
              description: 'Additional tokens to be added (default: 0)',
              default: 0
            }
          },
          required: ['session_id', 'model_max_tokens']
        }
      }
    ];
  }

  /**
   * Handle tool calls
   */
  async handleToolCall(name: string, args: any): Promise<any> {
    switch (name) {
      case 'conversation_paginate':
        return this.paginate(args);
      case 'conversation_get_page':
        return this.getPage(args);
      case 'conversation_context':
        return this.getContext(args);
      case 'conversation_navigate':
        return this.navigate(args);
      case 'conversation_info':
        return this.getInfo(args);
      case 'conversation_find_relevant':
        return this.findRelevant(args);
      case 'conversation_check_compaction':
        return this.checkCompaction(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async paginate(args: any) {
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

  private getPage(args: any) {
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

  private getContext(args: any) {
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
          ...context.previousPages.map(p => ({
            page_num: p.pageNum,
            content: p.content,
            context_type: 'PREV'
          })),
          {
            page_num: context.currentPage.pageNum,
            content: context.currentPage.content,
            context_type: 'CURRENT'
          },
          ...context.nextPages.map(p => ({
            page_num: p.pageNum,
            content: p.content,
            context_type: 'NEXT'
          }))
        ]
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private navigate(args: any) {
    const { session_id, current_page_num, direction } = args;
    
    const page = this.service.navigate({
      sessionId: session_id,
      currentPageNum: current_page_num,
      direction: direction as PageDirection
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

  private getInfo(args: any) {
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

  private findRelevant(args: any) {
    const { session_id, query, max_pages = 2 } = args;
    const pages = this.service.findRelevantPages(session_id, query, max_pages);

    return {
      success: true,
      session_id,
      query,
      found_pages: pages.length,
      pages: pages.map(p => ({
        page_num: p.pageNum,
        content: p.content,
        summary: p.summary
      }))
    };
  }

  private checkCompaction(args: any) {
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
      message: trigger.shouldCompact 
        ? `WARNING: Context ${trigger.currentTokens} exceeds safe limit for ${model_max_tokens} model. Suggested action: ${trigger.suggestedAction}`
        : `OK: Context ${trigger.currentTokens} is safe for ${model_max_tokens} model`
    };
  }
}
