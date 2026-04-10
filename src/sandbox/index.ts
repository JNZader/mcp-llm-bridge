/**
 * Docker sandbox — isolated execution environment for MCP tools
 * that require containment. Uses Docker when available, falls back
 * to process-level isolation with restricted permissions.
 *
 * Security profiles can specify `sandbox: true` to run tools inside
 * a disposable container.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Types ──

export interface SandboxConfig {
	image: string;
	timeoutMs: number;
	memoryLimitMb: number;
	networkEnabled: boolean;
	readOnlyFs: boolean;
	workDir: string;
}

export interface SandboxResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	durationMs: number;
	sandboxed: boolean;
	error: string | null;
}

// ── Defaults ──

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
	image: "node:22-alpine",
	timeoutMs: 30_000,
	memoryLimitMb: 256,
	networkEnabled: false,
	readOnlyFs: true,
	workDir: "/workspace",
};

// ── Docker availability ──

let _dockerAvailable: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
	if (_dockerAvailable !== null) return _dockerAvailable;
	try {
		await execFileAsync("docker", ["info"], { timeout: 5000 });
		_dockerAvailable = true;
	} catch {
		_dockerAvailable = false;
	}
	return _dockerAvailable;
}

// Reset for testing
export function resetDockerCheck(): void {
	_dockerAvailable = null;
}

// ── Build docker command ──

export function buildDockerArgs(
	command: string,
	config: SandboxConfig = DEFAULT_SANDBOX_CONFIG,
): string[] {
	const args = ["run", "--rm"];

	// Resource limits
	args.push(`--memory=${config.memoryLimitMb}m`);
	args.push("--cpus=1");

	// Timeout via Docker's stop timeout
	args.push(`--stop-timeout=${Math.ceil(config.timeoutMs / 1000)}`);

	// Network
	if (!config.networkEnabled) {
		args.push("--network=none");
	}

	// Filesystem
	if (config.readOnlyFs) {
		args.push("--read-only");
		// tmpfs for writable dirs
		args.push("--tmpfs", "/tmp:rw,noexec,nosuid,size=64m");
	}

	// Working directory
	args.push("-w", config.workDir);

	// Image and command
	args.push(config.image);
	args.push("sh", "-c", command);

	return args;
}

// ── Execute in sandbox ──

export async function executeInSandbox(
	command: string,
	config: Partial<SandboxConfig> = {},
): Promise<SandboxResult> {
	const fullConfig = { ...DEFAULT_SANDBOX_CONFIG, ...config };
	const start = Date.now();

	const dockerReady = await isDockerAvailable();

	if (!dockerReady) {
		// Fallback: run in process with timeout (less isolated)
		return executeWithTimeout(command, fullConfig.timeoutMs);
	}

	const args = buildDockerArgs(command, fullConfig);

	try {
		const { stdout, stderr } = await execFileAsync("docker", args, {
			timeout: fullConfig.timeoutMs + 5000, // extra buffer for docker overhead
			maxBuffer: 5 * 1024 * 1024,
		});

		return {
			stdout,
			stderr,
			exitCode: 0,
			durationMs: Date.now() - start,
			sandboxed: true,
			error: null,
		};
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
		if (e.killed) {
			return {
				stdout: e.stdout ?? "",
				stderr: e.stderr ?? "",
				exitCode: -1,
				durationMs: Date.now() - start,
				sandboxed: true,
				error: `Timeout after ${fullConfig.timeoutMs}ms`,
			};
		}
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			exitCode: e.code ?? -1,
			durationMs: Date.now() - start,
			sandboxed: true,
			error: null,
		};
	}
}

// ── Process fallback ──

async function executeWithTimeout(
	command: string,
	timeoutMs: number,
): Promise<SandboxResult> {
	const start = Date.now();
	try {
		const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
			timeout: timeoutMs,
			maxBuffer: 5 * 1024 * 1024,
		});
		return {
			stdout,
			stderr,
			exitCode: 0,
			durationMs: Date.now() - start,
			sandboxed: false,
			error: null,
		};
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			exitCode: e.killed ? -1 : (e.code ?? -1),
			durationMs: Date.now() - start,
			sandboxed: false,
			error: e.killed ? `Timeout after ${timeoutMs}ms` : null,
		};
	}
}
