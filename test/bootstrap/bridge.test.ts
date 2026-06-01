import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";

import { bootstrapBridge } from "../../src/bootstrap/bridge.js";
import { BridgeOrchestrator } from "../../src/bridge/orchestrator.js";
import { logger } from "../../src/core/logger.js";
import type { Router } from "../../src/core/router.js";

describe("bootstrapBridge", () => {
	it("returns null bridge state when bridge config is absent", () => {
		const result = bootstrapBridge({} as Router, "/nonexistent/bridge.yaml");

		assert.equal(result.bridgeConfig, null);
		assert.equal(result.bridge, null);
	});

	it("loads config, creates the orchestrator, and logs enablement", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "bootstrap-bridge-"));
		const configPath = join(tmpDir, "bridge.yaml");
		writeFileSync(
			configPath,
			[
				"routes:",
				"  code-review: claude-cli",
				"default: claude-cli",
				"fallback_order:",
				"  - claude-cli",
				"  - gemini-cli",
			].join("\n"),
		);

		const infoMock = mock.method(logger, "info", () => logger);

		try {
			const result = bootstrapBridge({} as Router, configPath);

			assert.ok(result.bridgeConfig);
			assert.ok(result.bridge instanceof BridgeOrchestrator);
			assert.ok(infoMock.mock.callCount() >= 2);
			assert.ok(
				infoMock.mock.calls.some(
					(call) =>
						call.arguments[0] ===
						"Bridge orchestrator enabled — task-aware routing active",
				),
			);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
