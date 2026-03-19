#!/usr/bin/env node

/**
 * MCP LLM Bridge — entrypoint.
 *
 * Modes:
 * - Default (no args):  MCP stdio server only (backward compatible)
 * - `--http`:           MCP stdio + HTTP server
 * - `serve`:            HTTP server only (no MCP stdio)
 */

import { loadConfig } from './core/config.js';
import { Router } from './core/router.js';
import { Vault } from './vault/index.js';
import { createAllAdapters } from './adapters/index.js';
import { startMcpServer } from './server/mcp.js';
import { startHttpServer } from './server/http.js';

// Parse mode from argv
const mode = process.argv[2]; // "serve" | "--http" | undefined

// Initialize shared components
const config = loadConfig();
const vault = new Vault(config);
const router = new Router();

// Register all adapters
for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

if (mode === 'serve') {
  // HTTP only
  startHttpServer(router, vault, config);
} else {
  // MCP stdio (default — backward compatible)
  await startMcpServer(router, vault);
  if (mode === '--http') {
    startHttpServer(router, vault, config);
  }
}
