import { logger } from "../core/logger.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

interface Destroyable {
	destroy(): void;
}

interface Closable {
	close(): void;
}

interface LatencyMeasurer {
	stopBackgroundTask(): void;
}

interface VaultLike {
	destroy(): void;
}

type ProcessOn = (
	event: ShutdownSignal,
	listener: () => void | Promise<void>,
) => void;

type ProcessExit = (code: number) => void;

export interface ShutdownDeps {
	compressor: Destroyable;
	latencyMeasurer: LatencyMeasurer;
	freeModelRouter: Destroyable;
	costTracker: Destroyable;
	groupStore: Closable;
	sessionManager: Destroyable;
	vault: VaultLike;
	cleanupAllProviderHomes: () => void;
	shutdownTracing: () => Promise<void>;
	processOn?: ProcessOn;
	processExit?: ProcessExit;
}

/**
 * Register graceful shutdown handlers for process termination signals.
 */
export async function setupGracefulShutdown({
	compressor,
	latencyMeasurer,
	freeModelRouter,
	costTracker,
	groupStore,
	sessionManager,
	vault,
	cleanupAllProviderHomes,
	shutdownTracing,
	processOn = process.on.bind(process) as ProcessOn,
	processExit = process.exit.bind(process) as ProcessExit,
}: ShutdownDeps): Promise<void> {
	const cleanup = async (signal: ShutdownSignal) => {
		logger.info({ signal }, "Shutting down");
		compressor.destroy();
		latencyMeasurer.stopBackgroundTask();
		freeModelRouter.destroy();
		costTracker.destroy();
		groupStore.close();
		sessionManager.destroy();
		cleanupAllProviderHomes();
		vault.destroy();
		await shutdownTracing();
		processExit(0);
	};

	for (const signal of SHUTDOWN_SIGNALS) {
		processOn(signal, () => cleanup(signal));
	}
}
