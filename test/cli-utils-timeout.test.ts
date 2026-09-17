import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { type CliError, execCliAsync } from "../src/adapters/cli-utils.js";

const FIXTURE_PATH = fileURLToPath(
	new URL("./helpers/cli-timeout-fixture.mjs", import.meta.url),
);
const POSIX_SKIP =
	process.platform === "win32"
		? "SIGTERM timeout behavior is POSIX-specific"
		: false;
const TIMEOUT_MS = 1200;
const TERMINATION_ERROR = "Process terminated before completion";
const CHILD_ENV = { PATH: "/nonexistent" };

function executeFixture(mode: string) {
	return execCliAsync(process.execPath, [FIXTURE_PATH, mode], {
		timeout: TIMEOUT_MS,
		env: CHILD_ENV,
	});
}

async function assertTerminated(mode: string): Promise<void> {
	await assert.rejects(executeFixture(mode), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.equal(error.message, TERMINATION_ERROR);
		const cliError = error as CliError;
		assert.match(cliError.stdout ?? "", /^READY:/);
		assert.equal((cliError.stdout ?? "").includes("WATCHDOG:99"), false);
		return true;
	});
}

test("execCliAsync preserves normal direct-child output", { skip: POSIX_SKIP }, async () => {
	const result = await executeFixture("normal");

	assert.equal(result.stdout, "READY:normal\nSTDOUT:normal\n");
	assert.equal(result.stderr, "STDERR:normal\n");
});

test("execCliAsync preserves nonzero direct-child rejection", { skip: POSIX_SKIP }, async () => {
	await assert.rejects(executeFixture("nonzero"), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.equal(error.message, "Process exited with code 7");
		const cliError = error as CliError;
		assert.equal(cliError.stdout, "READY:nonzero\n");
		assert.equal(cliError.stderr, "STDERR:nonzero:7\n");
		return true;
	});
});

test("execCliAsync rejects a direct child terminated during ordinary timeout", { skip: POSIX_SKIP }, async () => {
	await assertTerminated("ordinary-timeout");
});

test("execCliAsync rejects a direct child that exits zero only from SIGTERM", { skip: POSIX_SKIP }, async () => {
	await assertTerminated("sigterm-exit-zero");
});

test("execCliAsync escalates a TERM-resistant direct child before its watchdog", { skip: POSIX_SKIP }, async () => {
	const directory = await mkdtemp(join(tmpdir(), "cli-utils-timeout-"));
	const marker = join(directory, "term-marker");
	const startedAt = performance.now();
	try {
		await assert.rejects(
			execCliAsync(process.execPath, [FIXTURE_PATH, "term-resistant", marker], {
				timeout: TIMEOUT_MS,
				env: CHILD_ENV,
			}),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal(error.message, TERMINATION_ERROR);
				return true;
			},
		);
		assert.ok(performance.now() - startedAt < 4_000, "close must precede the fixture watchdog");
		assert.equal(await readFile(marker, "utf8"), "TERM:observed\n");
		assert.equal(await readFile(marker, "utf8"), "TERM:observed\n");
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
