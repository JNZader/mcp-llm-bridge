/**
 * MCP Builder — skill patterns for scaffolding high-quality MCP servers.
 *
 * Provides templates, validators, and helpers for building MCP server
 * integrations through the bridge. Inspired by anthropics/skills patterns.
 *
 * Usage:
 *   const builder = new McpServerBuilder('my-server', 'A helpful tool server');
 *   builder.addTool({ name: 'search', description: '...', inputSchema: {...}, handler: async (args) => ({...}) });
 *   builder.addResource({ uri: 'data://items', name: 'Items', mimeType: 'application/json', handler: async () => ({...}) });
 *   const definition = builder.build();
 */

// ── Types ──────────────────────────────────────────────────────

export interface ToolPattern {
  /** Tool name — must be snake_case. */
  name: string;
  /** Human-readable description for the LLM. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Handler function — receives validated args, returns content. */
  handler: ToolHandler;
  /** Optional examples of valid inputs for documentation. */
  examples?: ToolExample[];
}

export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
  expectedOutput?: string;
}

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

export interface ResourcePattern {
  /** Resource URI (e.g., 'data://items', 'file://config'). */
  uri: string;
  /** Human-readable name. */
  name: string;
  /** MIME type of the resource content. */
  mimeType: string;
  /** Description for discovery. */
  description?: string;
  /** Handler that returns the resource content. */
  handler: ResourceHandler;
}

export interface ResourceHandler {
  (): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType: string }> }>;
}

export interface PromptPattern {
  /** Prompt name — must be snake_case. */
  name: string;
  /** Description of what the prompt does. */
  description: string;
  /** Arguments the prompt accepts. */
  arguments: PromptArgument[];
  /** Handler that generates the prompt messages. */
  handler: PromptHandler;
}

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptHandler {
  (args: Record<string, string>): Promise<{
    messages: Array<{
      role: 'user' | 'assistant';
      content: { type: 'text'; text: string };
    }>;
  }>;
}

export interface McpServerDefinition {
  name: string;
  version: string;
  description: string;
  tools: ToolPattern[];
  resources: ResourcePattern[];
  prompts: PromptPattern[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

// ── Validation helpers ─────────────────────────────────────────

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const URI_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/.+$/;

function validateToolPattern(tool: ToolPattern, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = `tools[${index}]`;

  if (!SNAKE_CASE.test(tool.name)) {
    issues.push({
      severity: 'error',
      path: `${prefix}.name`,
      message: `Tool name "${tool.name}" must be snake_case (e.g., "search_code", "get_user")`,
    });
  }

  if (!tool.description || tool.description.length < 10) {
    issues.push({
      severity: 'warning',
      path: `${prefix}.description`,
      message: 'Tool description should be at least 10 characters for LLM comprehension',
    });
  }

  if (tool.description && tool.description.length > 500) {
    issues.push({
      severity: 'warning',
      path: `${prefix}.description`,
      message: 'Tool description over 500 chars may waste context. Be concise.',
    });
  }

  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
    issues.push({
      severity: 'error',
      path: `${prefix}.inputSchema`,
      message: 'Tool must have a valid inputSchema (JSON Schema object)',
    });
  }

  if (tool.inputSchema && !tool.inputSchema['type']) {
    issues.push({
      severity: 'warning',
      path: `${prefix}.inputSchema`,
      message: 'inputSchema should have a "type" field (typically "object")',
    });
  }

  return issues;
}

function validateResourcePattern(resource: ResourcePattern, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = `resources[${index}]`;

  if (!URI_PATTERN.test(resource.uri)) {
    issues.push({
      severity: 'error',
      path: `${prefix}.uri`,
      message: `Resource URI "${resource.uri}" must be a valid URI (e.g., "data://items")`,
    });
  }

  if (!resource.mimeType) {
    issues.push({
      severity: 'error',
      path: `${prefix}.mimeType`,
      message: 'Resource must specify a mimeType',
    });
  }

  return issues;
}

function validatePromptPattern(prompt: PromptPattern, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = `prompts[${index}]`;

  if (!SNAKE_CASE.test(prompt.name)) {
    issues.push({
      severity: 'error',
      path: `${prefix}.name`,
      message: `Prompt name "${prompt.name}" must be snake_case`,
    });
  }

  if (!prompt.description || prompt.description.length < 10) {
    issues.push({
      severity: 'warning',
      path: `${prefix}.description`,
      message: 'Prompt description should be descriptive for discoverability',
    });
  }

  return issues;
}

// ── Builder ────────────────────────────────────────────────────

/**
 * Fluent builder for MCP server definitions.
 *
 * Validates naming conventions, description quality, and schema
 * completeness as you add components. Call build() to get the
 * final validated definition.
 */
export class McpServerBuilder {
  private tools: ToolPattern[] = [];
  private resources: ResourcePattern[] = [];
  private prompts: PromptPattern[] = [];
  private version: string = '1.0.0';

  constructor(
    private readonly name: string,
    private readonly description: string,
  ) {}

  /** Set the server version. */
  setVersion(version: string): this {
    this.version = version;
    return this;
  }

  /** Add a tool to the server. */
  addTool(tool: ToolPattern): this {
    this.tools.push(tool);
    return this;
  }

  /** Add a resource to the server. */
  addResource(resource: ResourcePattern): this {
    this.resources.push(resource);
    return this;
  }

  /** Add a prompt template to the server. */
  addPrompt(prompt: PromptPattern): this {
    this.prompts.push(prompt);
    return this;
  }

  /**
   * Validate the current server definition.
   * Returns all issues found — errors and warnings.
   */
  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!this.name || this.name.length === 0) {
      issues.push({
        severity: 'error',
        path: 'name',
        message: 'Server name is required',
      });
    }

    if (this.tools.length === 0 && this.resources.length === 0 && this.prompts.length === 0) {
      issues.push({
        severity: 'warning',
        path: '',
        message: 'Server has no tools, resources, or prompts — add at least one capability',
      });
    }

    // Check for duplicate tool names
    const toolNames = new Set<string>();
    for (const tool of this.tools) {
      if (toolNames.has(tool.name)) {
        issues.push({
          severity: 'error',
          path: `tools.${tool.name}`,
          message: `Duplicate tool name: "${tool.name}"`,
        });
      }
      toolNames.add(tool.name);
    }

    for (let i = 0; i < this.tools.length; i++) {
      issues.push(...validateToolPattern(this.tools[i]!, i));
    }

    for (let i = 0; i < this.resources.length; i++) {
      issues.push(...validateResourcePattern(this.resources[i]!, i));
    }

    for (let i = 0; i < this.prompts.length; i++) {
      issues.push(...validatePromptPattern(this.prompts[i]!, i));
    }

    return issues;
  }

  /**
   * Build the server definition.
   * Throws if there are validation errors (warnings are allowed).
   */
  build(): McpServerDefinition {
    const issues = this.validate();
    const errors = issues.filter((i) => i.severity === 'error');

    if (errors.length > 0) {
      const messages = errors.map((e) => `  - [${e.path}] ${e.message}`).join('\n');
      throw new Error(`MCP server definition has ${errors.length} error(s):\n${messages}`);
    }

    return {
      name: this.name,
      version: this.version,
      description: this.description,
      tools: [...this.tools],
      resources: [...this.resources],
      prompts: [...this.prompts],
    };
  }
}

// ── Scaffold helpers ───────────────────────────────────────────

/**
 * Create a minimal tool pattern with sensible defaults.
 * Useful for quick prototyping — fill in the handler.
 */
export function scaffoldTool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string }>,
  required: string[] = [],
): Omit<ToolPattern, 'handler'> {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}

/**
 * Create a text-only tool result (most common case).
 */
export function textResult(text: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

/**
 * Create an error tool result.
 */
export function errorResult(message: string): ToolResult {
  return textResult(message, true);
}
