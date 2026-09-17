import { logger } from "../core/logger.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

interface Destroyable {
	destroy(): void | Promise<void>;
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

const DEFAULT_SHUTDOWN_DRAIN_MS = 5_000;

export interface HttpServerHandle {
	close(callback?: (error?: Error) => void): void;
	closeAllConnections?(): void;
}

export interface McpServerHandle {
	close(): void | Promise<void>;
}

export interface TransportHandles {
	httpServer?: HttpServerHandle;
	mcpServer?: McpServerHandle;
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
	analyticsAggregator: Destroyable;
	groupStore: Closable;
	sessionManager: Destroyable;
	pageIndexService?: Closable;
	vault: VaultLike;
	cleanupAllProviderHomes: () => void;
	shutdownTracing: () => Promise<void>;
	transports?: TransportHandles;
	drainMs?: number;
	processOn?: ProcessOn;
	processExit?: ProcessExit;
}

interface ShutdownFailure {
	step: string;
	error: unknown;
}

export function resolveShutdownDrainMs(
	raw: string | undefined = process.env.SHUTDOWN_DRAIN_MS,
): number {
	if (raw === undefined || raw === "") {
		return DEFAULT_SHUTDOWN_DRAIN_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return DEFAULT_SHUTDOWN_DRAIN_MS;
	}
	return parsed;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function closeHttpServer(server: HttpServerHandle, drainMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const done = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};
		const timer = setTimeout(() => {
			logger.warn({ drainMs }, "HTTP drain exceeded; closing remaining connections");
			server.closeAllConnections?.();
			done();
		}, drainMs);
		server.close((error) => {
			done(error);
		});
	});
}

async function closeMcpServer(server: McpServerHandle, drainMs: number): Promise<void> {
	let timedOut = false;
	await Promise.race([
		Promise.resolve(server.close()),
		delay(drainMs).then(() => {
			timedOut = true;
		}),
	]);
	if (timedOut) {
		logger.warn({ drainMs }, "MCP drain exceeded; continuing shutdown");
	}
}

/**
 * Register graceful shutdown handlers for process termination signals.
 */
export async function setupGracefulShutdown({
	compressor,
	latencyMeasurer,
	freeModelRouter,
	costTracker,
	analyticsAggregator,
	groupStore,
	sessionManager,
	pageIndexService,
	vault,
	cleanupAllProviderHomes,
	shutdownTracing,
	transports,
	drainMs = resolveShutdownDrainMs(),
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
			if (transports?.httpServer) {
				await runStep("httpServer.close", () =>
					closeHttpServer(transports.httpServer as HttpServerHandle, drainMs),
				);
			}
			if (transports?.mcpServer) {
				await runStep("mcpServer.close", () =>
					closeMcpServer(transports.mcpServer as McpServerHandle, drainMs),
				);
			}
			await runStep("compressor.destroy", () => compressor.destroy());
			await runStep("latencyMeasurer.stopBackgroundTask", () =>
				latencyMeasurer.stopBackgroundTask(),
			);
			await runStep("freeModelRouter.destroy", () => freeModelRouter.destroy());
			await runStep("costTracker.destroy", () => costTracker.destroy());
			await runStep("analyticsAggregator.destroy", () => analyticsAggregator.destroy());
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
