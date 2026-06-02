import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMetricsPath } from '../../src/server/http-helpers/metrics-path.js';

describe('normalizeMetricsPath', () => {
	it('normalizes known parameterized routes', () => {
		assert.equal(normalizeMetricsPath('/v1/credentials/123'), '/v1/credentials/:id');
		assert.equal(normalizeMetricsPath('/v1/files/abc'), '/v1/files/:id');
		assert.equal(normalizeMetricsPath('/v1/groups/42'), '/v1/groups/:id');
		assert.equal(normalizeMetricsPath('/v1/admin/profiles/proj-x'), '/v1/admin/profiles/:project');
		assert.equal(normalizeMetricsPath('/v1/admin/keys/key-1'), '/v1/admin/keys/:id');
		assert.equal(
			normalizeMetricsPath('/v1/admin/reset-circuit-breaker/openai'),
			'/v1/admin/reset-circuit-breaker/:provider',
		);
	});

	it('leaves already-stable paths unchanged', () => {
		assert.equal(normalizeMetricsPath('/v1/generate'), '/v1/generate');
		assert.equal(normalizeMetricsPath('/v1/analytics'), '/v1/analytics');
		assert.equal(normalizeMetricsPath('/health'), '/health');
	});
});
