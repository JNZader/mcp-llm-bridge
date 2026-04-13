/**
 * ACP ↔ MCP Translator
 *
 * Translates between ACP (Agent Client Protocol) and MCP (Model Context Protocol)
 * message formats. ACP represents editor→agent communication while MCP represents
 * LLM→tool communication. The translator bridges these two worlds.
 *
 * Translation flow:
 *   Editor → ACP request → translator → MCP tool call → LLM processes → MCP result → translator → ACP response → Editor
 */

import type {
  AcpStartTaskParams,
  AcpSendMessageParams,
  AcpContext,
  AcpTaskResult,
  AcpToolCallRecord,
} from './types.js';

// ─── MCP Types (subset used for translation) ─────────────────

/**
 * MCP tool call request — what gets sent to the LLM/tool server.
 * Modeled after the MCP SDK's CallToolRequest content.
 */
export interface McpToolCallRequest {
  /** Tool name to invoke */
  name: string;
  /** Arguments for the tool */
  arguments: Record<string, unknown>;
}

/**
 * MCP tool call result — what comes back from the tool server.
 */
export interface McpToolCallResult {
  /** Whether the call succeeded */
  isError: boolean;
  /** Result content blocks */
  content: McpContentBlock[];
}

export interface McpContentBlock {
  type: 'text' | 'resource';
  text?: string;
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
  };
}

/**
 * Intermediate representation used during translation.
 * Contains everything the bridge needs to process a task.
 */
export interface TranslationContext {
  /** Original ACP task description */
  description: string;
  /** System prompt built from ACP context */
  systemPrompt: string;
  /** User messages accumulated during the task */
  userMessages: string[];
  /** MCP tool calls to execute */
  toolCalls: McpToolCallRequest[];
  /** Results from executed tool calls */
  toolResults: McpToolCallResult[];
}

// ─── Translator ──────────────────────────────────────────────

export class AcpToMcpTranslator {
  /**
   * Build a system prompt from ACP context items.
   *
   * Converts editor-provided context (files, snippets, selections)
   * into a structured prompt that the LLM can use as grounding.
   */
  buildSystemPrompt(contexts: AcpContext[]): string {
    if (contexts.length === 0) {
      return '';
    }

    const sections = contexts.map((ctx) => {
      switch (ctx.type) {
        case 'file':
          return this.formatFileContext(ctx);
        case 'snippet':
          return this.formatSnippetContext(ctx);
        case 'selection':
          return this.formatSelectionContext(ctx);
        default:
          return `[Unknown context type: ${(ctx as AcpContext).type}]\n${ctx.content}`;
      }
    });

    return `The following context has been provided by the editor:\n\n${sections.join('\n\n')}`;
  }

  /**
   * Translate an ACP startTask request into an MCP-compatible prompt.
   *
   * Takes the task description + context and produces a structured
   * prompt ready to be sent through the bridge's generate pipeline.
   */
  translateStartTask(params: AcpStartTaskParams): TranslationContext {
    const contexts = params.context ?? [];
    const systemPrompt = this.buildSystemPrompt(contexts);

    return {
      description: params.description,
      systemPrompt,
      userMessages: [params.description],
      toolCalls: [],
      toolResults: [],
    };
  }

  /**
   * Translate an ACP sendMessage into an additional user message
   * appended to an existing translation context.
   */
  translateSendMessage(
    existing: TranslationContext,
    params: AcpSendMessageParams,
  ): TranslationContext {
    const role = params.role ?? 'user';
    const prefix = role === 'system' ? '[System] ' : '';

    return {
      ...existing,
      userMessages: [...existing.userMessages, `${prefix}${params.content}`],
    };
  }

  /**
   * Translate an MCP tool call result back into an ACP task result.
   *
   * Aggregates all tool call results into a single AcpTaskResult
   * with content extracted from MCP response blocks.
   */
  translateToolResultsToAcp(
    toolCalls: McpToolCallRequest[],
    toolResults: McpToolCallResult[],
  ): AcpTaskResult {
    const records: AcpToolCallRecord[] = toolCalls.map((call, i) => {
      const result = toolResults[i];
      return {
        toolName: call.name,
        arguments: call.arguments,
        result: result ? this.extractResultContent(result) : undefined,
      };
    });

    // Build the content string from all non-error results
    const contentParts: string[] = [];
    for (const result of toolResults) {
      if (!result.isError) {
        for (const block of result.content) {
          if (block.type === 'text' && block.text) {
            contentParts.push(block.text);
          } else if (block.type === 'resource' && block.resource?.text) {
            contentParts.push(block.resource.text);
          }
        }
      }
    }

    return {
      content: contentParts.join('\n') || 'Task completed with no text output.',
      toolCalls: records.length > 0 ? records : undefined,
    };
  }

  /**
   * Build a combined prompt string from a translation context.
   *
   * This is what actually gets sent to the LLM via the bridge's
   * generate pipeline.
   */
  buildPrompt(context: TranslationContext): string {
    return context.userMessages.join('\n\n');
  }

  /**
   * Build the full generate request parameters from a translation context.
   * Returns the shape expected by the bridge's GenerateRequest.
   */
  buildGenerateRequest(context: TranslationContext): {
    prompt: string;
    system?: string;
  } {
    return {
      prompt: this.buildPrompt(context),
      ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private formatFileContext(ctx: AcpContext): string {
    const lang = ctx.language ? ` (${ctx.language})` : '';
    const path = ctx.path ? `File: ${ctx.path}${lang}` : `File${lang}`;
    return `--- ${path} ---\n${ctx.content}`;
  }

  private formatSnippetContext(ctx: AcpContext): string {
    const lang = ctx.language ?? '';
    return `\`\`\`${lang}\n${ctx.content}\n\`\`\``;
  }

  private formatSelectionContext(ctx: AcpContext): string {
    const path = ctx.path ? ` in ${ctx.path}` : '';
    const range = ctx.range ? ` (lines ${ctx.range.start}-${ctx.range.end})` : '';
    return `--- Selection${path}${range} ---\n${ctx.content}`;
  }

  private extractResultContent(result: McpToolCallResult): string | undefined {
    const texts = result.content
      .filter((b): b is McpContentBlock & { text: string } =>
        b.type === 'text' && typeof b.text === 'string',
      )
      .map((b) => b.text);

    return texts.length > 0 ? texts.join('\n') : undefined;
  }
}
