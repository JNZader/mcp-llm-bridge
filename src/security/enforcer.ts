/**
 * ProfileEnforcer — runtime enforcement of security profiles on MCP handlers.
 *
 * Wraps ListTools and CallTool handlers to filter and authorize tool access
 * based on the active trust level. Uses the existing RateLimiter for
 * per-profile rate limiting.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RateLimiter } from '../server/rate-limit.js';
import { logger } from '../core/logger.js';
import type { TrustLevel } from '../core/types.js';
import {
  PROFILES,
  TOOL_CATEGORIES,
  type SecurityProfile,
  type ToolCategory,
  type ProfileResolver,
} from './profiles.js';

/** Minimal tool definition shape matching the TOOLS array in mcp.ts. */
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Enforces security profile rules on MCP tool access.
 *
 * - filterTools: removes tools the active profile cannot access
 * - authorize: checks if a specific tool call is allowed
 * - checkRate: enforces per-profile rate limiting
 * - wrapHandlers: intercepts MCP server ListTools/CallTool handlers
 *
 * Accepts either a static profile name (string) or a ProfileResolver
 * function for per-request dynamic resolution. When a resolver is
 * provided, call `resolveForProject(project)` to get a project-specific
 * enforcer state before calling filterTools/authorize.
 */
export class ProfileEnforcer {
  readonly profile: SecurityProfile;
  private readonly rateLimiter: RateLimiter | null;
  private readonly allowedCategories: Set<ToolCategory>;
  private readonly _resolver: ProfileResolver | null;

  constructor(profileNameOrResolver: string | ProfileResolver) {
    this._resolver = typeof profileNameOrResolver === 'function'
      ? profileNameOrResolver
      : null;

    // Resolve initial profile — string path uses static PROFILES
    const profile = typeof profileNameOrResolver === 'string'
      ? PROFILES[profileNameOrResolver as TrustLevel]
      : null; // resolver mode — no default profile until resolveForProject()

    if (typeof profileNameOrResolver === 'string' && !profile) {
      const valid = Object.keys(PROFILES).join(', ');
      throw new Error(
        `Unknown security profile "${profileNameOrResolver}". Valid profiles: ${valid}`,
      );
    }

    // For resolver mode, default to 'restricted' until per-request resolution
    this.profile = profile ?? PROFILES['restricted'];
    this.allowedCategories = new Set(this.profile.allowedCategories);

    if (this.profile.rateLimit) {
      this.rateLimiter = new RateLimiter({
        max: this.profile.rateLimit.max,
        windowMs: this.profile.rateLimit.windowMs,
      });
    } else {
      this.rateLimiter = null;
    }

    logger.info(
      {
        profile: this.profile.level,
        allowedCategories: this.profile.allowedCategories,
        rateLimit: this.profile.rateLimit,
        mode: this._resolver ? 'dynamic-resolver' : 'static',
      },
      'Security profile enforcer initialized',
    );
  }

  /**
   * Resolve a project-specific profile using the configured resolver.
   * Falls back to the static default profile if no resolver is set
   * or the resolver returns null for the given project.
   *
   * Returns a SecurityProfile (never null).
   */
  resolveForProject(project: string): SecurityProfile {
    if (!this._resolver) return this.profile;

    const resolved = this._resolver(project);
    return resolved ?? this.profile;
  }

  /**
   * Filter a list of tools to only those allowed by the active profile.
   */
  filterTools(tools: readonly ToolDef[]): ToolDef[] {
    return tools.filter((tool) => {
      const category = TOOL_CATEGORIES[tool.name];
      if (!category) {
        // Unknown tools are blocked by default (safe-by-default)
        logger.warn(
          { tool: tool.name, profile: this.profile.level },
          'Tool not found in TOOL_CATEGORIES — blocked by default',
        );
        return false;
      }
      return this.allowedCategories.has(category);
    });
  }

  /**
   * Check if a tool call is authorized under the active profile.
   * Returns true if allowed, false if denied.
   */
  authorize(toolName: string): boolean {
    const category = TOOL_CATEGORIES[toolName];

    if (!category || !this.allowedCategories.has(category)) {
      logger.warn(
        {
          tool: toolName,
          category: category ?? 'unknown',
          profile: this.profile.level,
        },
        'Tool call denied by security profile',
      );
      return false;
    }

    return true;
  }

  /**
   * Check rate limit for the active profile.
   * Returns { allowed: true } or { allowed: false, retryAfter: ms }.
   */
  checkRate(): { allowed: boolean; retryAfter?: number } {
    if (!this.rateLimiter) {
      return { allowed: true };
    }

    const key = 'mcp-security';
    const limited = this.rateLimiter.isRateLimited(key);

    if (limited) {
      const resetAt = this.rateLimiter.getResetAt(key);
      const retryAfter = Math.max(0, resetAt - Date.now());
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  }

  /**
   * Wrap the MCP server's ListTools and CallTool handlers with
   * profile enforcement. The original handlers are preserved as
   * delegates — this method intercepts before forwarding.
   */
  wrapHandlers(
    server: Server,
    tools: readonly ToolDef[],
    handleToolCall: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>,
  ): void {
    // Wrap ListTools — return filtered tool list
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.filterTools(tools),
    }));

    // Wrap CallTool — check authorization + rate limit before delegating
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Authorization check
      if (!this.authorize(name)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Access denied: tool "${name}" is not allowed under the "${this.profile.level}" security profile.`,
            },
          ],
          isError: true,
        };
      }

      // Rate limit check
      const rateResult = this.checkRate();
      if (!rateResult.allowed) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Rate limit exceeded for "${this.profile.level}" profile. Try again in ${Math.ceil((rateResult.retryAfter ?? 0) / 1000)} seconds.`,
            },
          ],
          isError: true,
        };
      }

      return handleToolCall(name, (args ?? {}) as Record<string, unknown>);
    });
  }

  /**
   * Cleanup resources (RateLimiter interval).
   */
  destroy(): void {
    this.rateLimiter?.destroy();
  }
}
