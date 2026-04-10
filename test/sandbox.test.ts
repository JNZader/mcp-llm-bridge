import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDockerArgs,
	DEFAULT_SANDBOX_CONFIG,
	executeInSandbox,
	resetDockerCheck,
} from '../src/sandbox/index.js';

describe('buildDockerArgs', () => {
	it('includes resource limits', () => {
		const args = buildDockerArgs('echo hello');
		assert.ok(args.includes('--memory=256m'));
		assert.ok(args.includes('--cpus=1'));
	});

	it('disables network by default', () => {
		const args = buildDockerArgs('echo hello');
		assert.ok(args.includes('--network=none'));
	});

	it('enables network when configured', () => {
		const args = buildDockerArgs('echo hello', {
			...DEFAULT_SANDBOX_CONFIG,
			networkEnabled: true,
		});
		assert.ok(!args.includes('--network=none'));
	});

	it('sets read-only filesystem by default', () => {
		const args = buildDockerArgs('echo hello');
		assert.ok(args.includes('--read-only'));
	});

	it('includes image and command', () => {
		const args = buildDockerArgs('echo hello');
		assert.ok(args.includes('node:22-alpine'));
		assert.ok(args.includes('echo hello'));
	});

	it('includes --rm for cleanup', () => {
		const args = buildDockerArgs('test');
		assert.ok(args.includes('--rm'));
	});
});

describe('executeInSandbox (process fallback)', () => {
	// Force process fallback by resetting docker check
	it('executes simple command', async () => {
		resetDockerCheck();
		const result = await executeInSandbox('echo "sandbox test"', {
			timeoutMs: 5000,
		});
		assert.ok(result.stdout.includes('sandbox test'));
		assert.equal(result.exitCode, 0);
	});

	it('captures exit code on failure', async () => {
		resetDockerCheck();
		const result = await executeInSandbox('exit 42', { timeoutMs: 5000 });
		assert.equal(result.exitCode, 42);
	});

	it('returns duration tracking', async () => {
		resetDockerCheck();
		const result = await executeInSandbox('echo fast', { timeoutMs: 5000 });
		assert.ok(result.durationMs >= 0);
		assert.ok(typeof result.sandboxed === 'boolean');
	});

	it('tracks duration', async () => {
		resetDockerCheck();
		const result = await executeInSandbox('echo fast', { timeoutMs: 5000 });
		assert.ok(result.durationMs >= 0);
	});
});
