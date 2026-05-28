# Tasks: MCP Builder Runtime Integration

## Batch 1: Adapter (`src/mcp-builder/adapter.ts`)

**Focus**: Bridge `McpServerDefinition` to SDK `Server` via internal accumulation + dispatch.

- [ ] 1.1 Create `src/mcp-builder/adapter.ts` with `McpDefinitionAdapter` class and imports for `Server`, `ToolCategory`, `McpServerDefinition`, `ToolResult`
- [ ] 1.2 Implement `register(server: Server, definition: McpServerDefinition): void` — validate definition, store tools internally in a `Map<string, ToolPattern>`
- [ ] 1.3 Implement collision detection inside `register`: if `this._tools.has(tool.name)`, log warning via `logger.warn()` and skip the colliding tool; continue registering remaining tools
- [ ] 1.4 Implement `getTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>` — return schemas of all stored dynamic tools for `ListTools` merging
- [ ] 1.5 Implement `handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult | null>` — lookup tool by name, invoke `tool.handler(args)`, wrap errors in `isError: true` with error message text; return `null` if tool not found
- [ ] 1.6 Implement `getCategoryMap(): Record<string, ToolCategory>` — return `_categoryMap` merged with any explicitly set categories
- [ ] 1.7 Implement `setToolCategory(toolName: string, category: ToolCategory): void` — set explicit security category for a dynamic tool (stored in `_categoryMap`)
- [ ] 1.8 Verify `ToolResult` shape compatibility: ensure adapter returns `{ content: [{ type: 'text', text: ... }], isError: boolean }` which matches SDK `CallToolResult` expectations

## Batch 2: Plugin Loader (`src/mcp-builder/loader.ts`)

**Focus**: Scan, load, and validate `.mcp-server.js` plugin files from disk.

- [ ] 2.1 Create `src/mcp-builder/loader.ts` with `loadPlugins(options?: LoadPluginsOptions): Promise<McpServerDefinition[]>` function
- [ ] 2.2 Define `LoadPluginsOptions` interface with optional `dir?: string` field
- [ ] 2.3 Implement directory resolution: `options.dir` → `process.env['MCP_SERVERS_DIR']` → `./mcp-servers` (relative to cwd) — use `path.resolve()`
- [ ] 2.4 Implement directory scanning with `readdirSync` + `existsSync` (sync `fs` per project convention), filtering files matching `*.mcp-server.js`
- [ ] 2.5 Implement ESM dynamic import per file: `await import(filePath)` — support both default export and named export `definition`
- [ ] 2.6 Support async function exports: if export is a function, invoke it and await result; validate returned object is `McpServerDefinition`
- [ ] 2.7 Validate each loaded definition via `McpServerBuilder.validate()` — log warnings at `warn` level, reject (skip file) on validation errors with `logger.error()`
- [ ] 2.8 Implement graceful failure: wrap per-file load in `try/catch`, log `error` with filename and message, never throw from the main load loop
- [ ] 2.9 Handle edge cases: empty directory (return `[]`), missing directory (return `[]` + `logger.warn()`), non-matching files (ignore silently), invalid export shape (log warning + skip)

## Batch 3: Runtime Wiring (`src/server/mcp.ts`, `src/security/enforcer.ts`)

**Focus**: Integrate adapter and loader into existing server startup with feature flag and security profile support.

- [ ] 3.1 Modify `src/security/enforcer.ts`: add optional `extraToolCategories?: Record<string, ToolCategory>` as second constructor parameter
- [ ] 3.2 Update `ProfileEnforcer` internal lookup: merge `extraToolCategories` into `_categoryMap` field; update `filterTools()` and `authorize()` to use `this._extraCategories[tool.name] ?? TOOL_CATEGORIES[tool.name]`
- [ ] 3.3 Add imports in `src/server/mcp.ts`: `import { McpDefinitionAdapter } from '../mcp-builder/adapter.js'` and `import { loadPlugins } from '../mcp-builder/loader.js'`
- [ ] 3.4 In `startMcpServer()`, after static `Server` instantiation and static `setRequestHandler` calls, add conditional block: `if (process.env['MCP_DYNAMIC_SERVERS'] === 'true')`
- [ ] 3.5 Inside conditional: `const definitions = await loadPlugins(); const adapter = new McpDefinitionAdapter(); definitions.forEach(d => adapter.register(server, d))`
- [ ] 3.6 Merge dynamic tools into `ListToolsRequestSchema` handler: update response to include `...adapter.getTools()` alongside static `TOOLS`
- [ ] 3.7 Update `CallToolRequestSchema` handler: extract `name` and `arguments`, call `adapter.handleToolCall(name, args)`; if result is non-null return it; if `null` fall back to existing static `_handleToolCall(...)`
- [ ] 3.8 Pass `adapter.getCategoryMap()` to `ProfileEnforcer` constructor when `securityProfile` is active and dynamic loading is enabled — ensure enforcer sees merged static + dynamic tool categories
- [ ] 3.9 Add `logger.info()` call after successful dynamic loading: log server name(s) and tool count per server
- [ ] 3.10 Ensure when `MCP_DYNAMIC_SERVERS` is unset or not `'true'`, zero dynamic loading code executes and behavior is identical to pre-change

## Batch 4: Tests and Documentation

**Focus**: Verify adapter, loader, and runtime integration with unit tests; update README.

- [ ] 4.1 Create `test/mcp-builder/adapter.test.ts`: test `register()` stores tools, `getTools()` returns correct schemas, `handleToolCall()` invokes correct handler, error wrapping returns `isError: true`, collision detection skips duplicate names
- [ ] 4.2 Create `test/mcp-builder/loader.test.ts`: test scans directory and filters `*.mcp-server.js`, loads default export, loads named export `definition`, validates definitions, skips invalid exports, catches load errors gracefully, handles missing directory
- [ ] 4.3 Add integration-style test in `test/mcp-builder/adapter.test.ts`: verify `ToolResult` text content shape matches SDK `CallToolResult` expectations
- [ ] 4.4 Verify in `test/mcp-builder/loader.test.ts` that `McpServerBuilder.validate()` is called and its warnings/errors are logged appropriately
- [ ] 4.5 Update `README.md` with a copy-pasteable plugin authoring example showing a `.mcp-server.js` file using `McpServerBuilder`, `textResult`, and `export default builder.build()`
- [ ] 4.6 Run `pnpm test` and confirm: (a) all 13 existing `mcp-builder` tests pass, (b) new adapter tests pass, (c) new loader tests pass, (d) existing server tests pass
- [ ] 4.7 Run `pnpm typecheck` (or `tsc --noEmit`) and confirm zero type errors across modified and new files
- [ ] 4.8 Verify via manual test or mock that `MCP_DYNAMIC_SERVERS=false` (or unset) results in zero dynamic tool registration
