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
	pageIndexService?: Closable;
	vault: VaultLike;
	cleanupAllProviderHomes: () => void;
	shutdownTracing: () => Promise<void>;
	processOn?: ProcessOn;
	processExit?: ProcessExit;
}

interface ShutdownFailure {
	step: string;
	error: unknown;
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
	pageIndexService,
	vault,
	cleanupAllProviderHomes,
	shutdownTracing,
	processOn = process.on.bind(process) as ProcessOn,
	processExit = process.exit.bind(process) as ProcessExit,
}: ShutdownDeps): Promise<void> {
	let cleanupPromise: Promise<void> | undefined;

	const cleanup = async (signal: ShutdownSignal) => {
		if (cleanupPromise) {
			return cleanupPromise;
		}

		cleanupPromise = (async () => {
			const failures: ShutdownFailure[] = [];

			const runStep = async (step: string, action: () => void | Promise<void>) => {
				try {
					await action();
				} catch (error) {
					failures.push({ step, error });
					logger.error({ error, step, signal }, "Graceful shutdown step failed");
				}
			};

			logger.info({ signal }, "Shutting down");
			await runStep("compressor.destroy", () => compressor.destroy());
			await runStep("latencyMeasurer.stopBackgroundTask", () =>
				latencyMeasurer.stopBackgroundTask(),
			);
			await runStep("freeModelRouter.destroy", () => freeModelRouter.destroy());
			await runStep("costTracker.destroy", () => costTracker.destroy());
			await runStep("groupStore.close", () => groupStore.close());
			await runStep("sessionManager.destroy", () => sessionManager.destroy());
			await runStep("pageIndexService.close", () => pageIndexService?.close());
			await runStep("cleanupAllProviderHomes", cleanupAllProviderHomes);
			await runStep("vault.destroy", () => vault.destroy());
			await runStep("shutdownTracing", shutdownTracing);

			if (failures.length > 0) {
				const shutdownError = new AggregateError(
					failures.map(({ error }) => error),
					`Graceful shutdown failed in ${failures.length} step(s): ${failures
						.map(({ step }) => step)
						.join(", ")}`,
				);

				logger.error(
					{
						error: shutdownError,
						failures: failures.map(({ step, error }) => ({ step, error })),
						signal,
					},
					"Graceful shutdown completed with errors",
				);
				processExit(1);
				return;
			}

			processExit(0);
		})();

		return cleanupPromise;
	};

	for (const signal of SHUTDOWN_SIGNALS) {
		processOn(signal, () => cleanup(signal));
	}
}
