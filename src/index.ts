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
import { CostTracker } from './core/cost-tracker.js';
import { GroupStore } from './core/groups.js';
import { SessionStore } from './core/session.js';
import { registry } from './core/transformer.js';
import { BridgeOrchestrator, loadBridgeConfig } from './bridge/index.js';
import { CompressorService } from './context-compression/index.js';
import { CodeSearchService } from './code-search/index.js';
import { StateManager } from './crdt/index.js';
import { FreeModelRouter } from './free-models/index.js';

// Populate the transformer registry with all inbound/outbound transformers
import './transformers/index.js';

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

// Initialize cost tracker (uses same DB path as vault)
const costTracker = new CostTracker({ dbPath: config.dbPath });
router.setCostTracker(costTracker);

// Wire up transformer registry for the new pipeline
router.setTransformerRegistry(registry);

// Initialize group store (uses same DB path as vault)
const groupStore = new GroupStore(config.dbPath);
router.setGroupStore(groupStore);

// Initialize session store (in-memory with TTL sweep)
const sessionStore = new SessionStore();
router.setSessionStore(sessionStore);

// Initialize context compression service (background pre-computation)
const compressor = new CompressorService();

// Initialize semantic code search service (in-memory index)
const codeSearch = new CodeSearchService();

// Initialize CRDT state manager for multi-agent collaboration
const stateManager = new StateManager();

// Initialize free model router (opt-in via FALLBACK_STRATEGY=free-models)
const freeModelEnabled = process.env['FALLBACK_STRATEGY'] === 'free-models';
const freeModelRouter = new FreeModelRouter({ enabled: freeModelEnabled });
if (freeModelEnabled) {
  router.setFreeModelRouter(freeModelRouter);
  logger.info('Free model fallback routing enabled');
}

// Initialize bridge orchestrator (opt-in via bridge.yaml config)
const bridgeConfig = loadBridgeConfig();
const bridge = bridgeConfig ? new BridgeOrchestrator(router, bridgeConfig) : null;
if (bridge) {
  logger.info('Bridge orchestrator enabled — task-aware routing active');
}

/**
 * Graceful shutdown handler.
 * Closes the vault database connection, provider homes, and tracing on exit.
 */
async function setupGracefulShutdown(vault: Vault): Promise<void> {
  const cleanup = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    compressor.destroy();
    freeModelRouter.destroy();
    costTracker.destroy();
    groupStore.close();
    sessionStore.destroy();
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
  startHttpServer(router, vault, config, groupStore, costTracker);
} else {
  // MCP stdio (default — backward compatible)
  await startMcpServer(router, vault, undefined, costTracker, bridge, codeSearch, stateManager);
  if (mode === '--http') {
    startHttpServer(router, vault, config, groupStore, costTracker);
  }
}
