import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";

import {
	createComparisonServices,
	createCoreServices,
	createToolingServices,
} from "../../src/bootstrap/core-services.js";
import { Vault } from "../../src/vault/vault.js";
import type { GatewayConfig } from "../../src/core/types.js";

const dbPath = `/tmp/test-core-services-${Date.now()}.db`;

const config: GatewayConfig = {
	masterKey: randomBytes(32),
	dbPath,
	httpPort: 0,
};

const vault = new Vault(config);

after(() => {
	vault.close();
	for (const suffix of ["", "-wal", "-shm"]) {
		const filePath = dbPath + suffix;
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	}
});

describe("createCoreServices", () => {
	it("constructs the passive service graph without starting session cleanup", () => {
		const coreServices = createCoreServices({
			db: vault.getDb(),
			dbPath,
		});
		const toolingServices = createToolingServices({
			db: vault.getDb(),
			dbPath,
		});
		const comparisonServices = createComparisonServices({
			db: vault.getDb(),
			dbPath,
		});

		assert.ok(coreServices.requestLogger);
		assert.ok(coreServices.costTracker);
		assert.ok(coreServices.analyticsAggregator);
		assert.ok(coreServices.groupStore);
		assert.ok(coreServices.sessionManager);
		assert.ok(coreServices.compressor);
		assert.ok(coreServices.codeSearch);
		assert.ok(coreServices.stateManager);
		assert.ok(toolingServices.approvalStore);
		assert.ok(toolingServices.pageIndex.service);
		assert.ok(toolingServices.pageIndexTools);
		assert.ok(comparisonServices.comparisonStore);
		assert.equal((coreServices.sessionManager as { cleanupTimer?: unknown }).cleanupTimer, undefined);

		coreServices.compressor.destroy();
		coreServices.costTracker.destroy();
		coreServices.groupStore.close();
		coreServices.sessionManager.destroy();
		toolingServices.pageIndex.service.close();
	});
});
