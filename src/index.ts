#!/usr/bin/env node

/**
 * MCP LLM Bridge — entrypoint.
 *
 * Modes:
 * - Default (no args):  MCP stdio server only (backward compatible)
 * - `--http`:           MCP stdio + HTTP server
 * - `serve`:            HTTP server only (no MCP stdio)
 */

// Initialize tracing before other imports
import { initTracing, shutdownTracing } from './core/tracing.js';
initTracing();

import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { initMetrics } from './core/metrics.js';
import { Router } from './core/router.js';
import { Vault } from './vault/index.js';
import { createAllAdapters } from './adapters/index.js';
import { startMcpServer } from './server/mcp.js';
import { startHttpServer } from './server/http.js';
import { cleanupAllProviderHomes } from './adapters/cli-home.js';

// Initialize metrics
initMetrics();

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

/**
 * Graceful shutdown handler.
 * Closes the vault database connection, provider homes, and tracing on exit.
 */
async function setupGracefulShutdown(vault: Vault): Promise<void> {
  const cleanup = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    cleanupAllProviderHomes();
    vault.close();
    await shutdownTracing();
    process.exit(0);
  };

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
}

// Setup graceful shutdown
await setupGracefulShutdown(vault);

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
