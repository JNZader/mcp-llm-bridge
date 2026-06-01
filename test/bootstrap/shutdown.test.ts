import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { setupGracefulShutdown } from "../../src/bootstrap/shutdown.js";

describe("setupGracefulShutdown", () => {
	it("registers SIGINT and SIGTERM handlers", async () => {
		const listeners = new Map<string, () => void | Promise<void>>();
		const processOn = mock.fn(
			(signal: "SIGINT" | "SIGTERM", listener: () => void | Promise<void>) => {
				listeners.set(signal, listener);
			},
		);

		await setupGracefulShutdown({
			compressor: { destroy() {} },
			latencyMeasurer: { stopBackgroundTask() {} },
			freeModelRouter: { destroy() {} },
			costTracker: { destroy() {} },
			groupStore: { close() {} },
			sessionManager: { destroy() {} },
			pageIndexService: { close() {} },
			vault: { destroy() {} },
			cleanupAllProviderHomes() {},
			shutdownTracing: async () => {},
			processOn,
			processExit: () => {},
		});

		assert.equal(processOn.mock.callCount(), 2);
		assert.ok(listeners.has("SIGINT"));
		assert.ok(listeners.has("SIGTERM"));
	});

	it("runs shutdown steps in the existing order before exiting", async () => {
		const events: string[] = [];
		const listeners = new Map<string, () => void | Promise<void>>();

		await setupGracefulShutdown({
			compressor: { destroy: () => events.push("compressor.destroy") },
			latencyMeasurer: {
				stopBackgroundTask: () => events.push("latencyMeasurer.stopBackgroundTask"),
			},
			freeModelRouter: { destroy: () => events.push("freeModelRouter.destroy") },
			costTracker: { destroy: () => events.push("costTracker.destroy") },
			groupStore: { close: () => events.push("groupStore.close") },
			sessionManager: { destroy: () => events.push("sessionManager.destroy") },
			pageIndexService: { close: () => events.push("pageIndexService.close") },
			vault: { destroy: () => events.push("vault.destroy") },
			cleanupAllProviderHomes: () => events.push("cleanupAllProviderHomes"),
			shutdownTracing: async () => {
				events.push("shutdownTracing.start");
				events.push("shutdownTracing.end");
			},
			processOn: (signal, listener) => {
				listeners.set(signal, listener);
			},
			processExit: (code) => {
				events.push(`processExit:${code}`);
			},
		});

		const sigtermHandler = listeners.get("SIGTERM");
		assert.ok(sigtermHandler);

		await sigtermHandler?.();

		assert.deepEqual(events, [
			"compressor.destroy",
			"latencyMeasurer.stopBackgroundTask",
			"freeModelRouter.destroy",
			"costTracker.destroy",
			"groupStore.close",
			"sessionManager.destroy",
			"pageIndexService.close",
			"cleanupAllProviderHomes",
			"vault.destroy",
			"shutdownTracing.start",
			"shutdownTracing.end",
			"processExit:0",
		]);
	});

	it("does not re-run teardown when shutdown is triggered more than once", async () => {
		const events: string[] = [];
		const listeners = new Map<string, () => void | Promise<void>>();

		await setupGracefulShutdown({
			compressor: { destroy: () => events.push("compressor.destroy") },
			latencyMeasurer: {
				stopBackgroundTask: () => events.push("latencyMeasurer.stopBackgroundTask"),
			},
			freeModelRouter: { destroy: () => events.push("freeModelRouter.destroy") },
			costTracker: { destroy: () => events.push("costTracker.destroy") },
			groupStore: { close: () => events.push("groupStore.close") },
			sessionManager: { destroy: () => events.push("sessionManager.destroy") },
			pageIndexService: { close: () => events.push("pageIndexService.close") },
			vault: { destroy: () => events.push("vault.destroy") },
			cleanupAllProviderHomes: () => events.push("cleanupAllProviderHomes"),
			shutdownTracing: async () => {
				events.push("shutdownTracing.start");
				events.push("shutdownTracing.end");
			},
			processOn: (signal, listener) => {
				listeners.set(signal, listener);
			},
			processExit: (code) => {
				events.push(`processExit:${code}`);
			},
		});

		const sigintHandler = listeners.get("SIGINT");
		const sigtermHandler = listeners.get("SIGTERM");
		assert.ok(sigintHandler);
		assert.ok(sigtermHandler);

		await sigintHandler?.();
		await sigtermHandler?.();

		assert.deepEqual(events, [
			"compressor.destroy",
			"latencyMeasurer.stopBackgroundTask",
			"freeModelRouter.destroy",
			"costTracker.destroy",
			"groupStore.close",
			"sessionManager.destroy",
			"pageIndexService.close",
			"cleanupAllProviderHomes",
			"vault.destroy",
			"shutdownTracing.start",
			"shutdownTracing.end",
			"processExit:0",
		]);
	});

	it("continues later shutdown steps after an early synchronous failure", async () => {
		const events: string[] = [];
		const listeners = new Map<string, () => void | Promise<void>>();

		await setupGracefulShutdown({
			compressor: {
				destroy: () => {
					events.push("compressor.destroy");
					throw new Error("compressor failed");
				},
			},
			latencyMeasurer: {
				stopBackgroundTask: () => events.push("latencyMeasurer.stopBackgroundTask"),
			},
			freeModelRouter: { destroy: () => events.push("freeModelRouter.destroy") },
			costTracker: { destroy: () => events.push("costTracker.destroy") },
			groupStore: { close: () => events.push("groupStore.close") },
			sessionManager: { destroy: () => events.push("sessionManager.destroy") },
			pageIndexService: { close: () => events.push("pageIndexService.close") },
			vault: { destroy: () => events.push("vault.destroy") },
			cleanupAllProviderHomes: () => events.push("cleanupAllProviderHomes"),
			shutdownTracing: async () => {
				events.push("shutdownTracing.start");
				events.push("shutdownTracing.end");
			},
			processOn: (signal, listener) => {
				listeners.set(signal, listener);
			},
			processExit: (code) => {
				events.push(`processExit:${code}`);
			},
		});

		const sigintHandler = listeners.get("SIGINT");
		assert.ok(sigintHandler);

		await sigintHandler?.();

		assert.deepEqual(events, [
			"compressor.destroy",
			"latencyMeasurer.stopBackgroundTask",
			"freeModelRouter.destroy",
			"costTracker.destroy",
			"groupStore.close",
			"sessionManager.destroy",
			"pageIndexService.close",
			"cleanupAllProviderHomes",
			"vault.destroy",
			"shutdownTracing.start",
			"shutdownTracing.end",
			"processExit:1",
		]);
	});

	it("exits non-zero when shutdownTracing rejects", async () => {
		const events: string[] = [];
		const listeners = new Map<string, () => void | Promise<void>>();

		await setupGracefulShutdown({
			compressor: { destroy: () => events.push("compressor.destroy") },
			latencyMeasurer: {
				stopBackgroundTask: () => events.push("latencyMeasurer.stopBackgroundTask"),
			},
			freeModelRouter: { destroy: () => events.push("freeModelRouter.destroy") },
			costTracker: { destroy: () => events.push("costTracker.destroy") },
			groupStore: { close: () => events.push("groupStore.close") },
			sessionManager: { destroy: () => events.push("sessionManager.destroy") },
			pageIndexService: { close: () => events.push("pageIndexService.close") },
			vault: { destroy: () => events.push("vault.destroy") },
			cleanupAllProviderHomes: () => events.push("cleanupAllProviderHomes"),
			shutdownTracing: async () => {
				events.push("shutdownTracing.start");
				throw new Error("tracing failed");
			},
			processOn: (signal, listener) => {
				listeners.set(signal, listener);
			},
			processExit: (code) => {
				events.push(`processExit:${code}`);
			},
		});

		const sigtermHandler = listeners.get("SIGTERM");
		assert.ok(sigtermHandler);

		await sigtermHandler?.();

		assert.deepEqual(events, [
			"compressor.destroy",
			"latencyMeasurer.stopBackgroundTask",
			"freeModelRouter.destroy",
			"costTracker.destroy",
			"groupStore.close",
			"sessionManager.destroy",
			"pageIndexService.close",
			"cleanupAllProviderHomes",
			"vault.destroy",
			"shutdownTracing.start",
			"processExit:1",
		]);
	});

	it("does not re-run teardown after a failed shutdown path", async () => {
		const events: string[] = [];
		const listeners = new Map<string, () => void | Promise<void>>();

		await setupGracefulShutdown({
			compressor: { destroy: () => events.push("compressor.destroy") },
			latencyMeasurer: {
				stopBackgroundTask: () => events.push("latencyMeasurer.stopBackgroundTask"),
			},
			freeModelRouter: {
				destroy: () => {
					events.push("freeModelRouter.destroy");
					throw new Error("router failed");
				},
			},
			costTracker: { destroy: () => events.push("costTracker.destroy") },
			groupStore: { close: () => events.push("groupStore.close") },
			sessionManager: { destroy: () => events.push("sessionManager.destroy") },
			pageIndexService: { close: () => events.push("pageIndexService.close") },
			vault: { destroy: () => events.push("vault.destroy") },
			cleanupAllProviderHomes: () => events.push("cleanupAllProviderHomes"),
			shutdownTracing: async () => {
				events.push("shutdownTracing.start");
				events.push("shutdownTracing.end");
			},
			processOn: (signal, listener) => {
				listeners.set(signal, listener);
			},
			processExit: (code) => {
				events.push(`processExit:${code}`);
			},
		});

		const sigintHandler = listeners.get("SIGINT");
		const sigtermHandler = listeners.get("SIGTERM");
		assert.ok(sigintHandler);
		assert.ok(sigtermHandler);

		await sigintHandler?.();
		await sigtermHandler?.();

		assert.deepEqual(events, [
			"compressor.destroy",
			"latencyMeasurer.stopBackgroundTask",
			"freeModelRouter.destroy",
			"costTracker.destroy",
			"groupStore.close",
			"sessionManager.destroy",
			"pageIndexService.close",
			"cleanupAllProviderHomes",
			"vault.destroy",
			"shutdownTracing.start",
			"shutdownTracing.end",
			"processExit:1",
		]);
	});
});
