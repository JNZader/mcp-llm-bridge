import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	hasStaticBearerToken,
	parseBearerToken,
	tokenEquals,
} from '../../../src/server/auth-helpers/bearer.js';

describe('bearer auth helpers', () => {
	it('parses only valid Bearer headers', () => {
		assert.equal(parseBearerToken(undefined), null);
		assert.equal(parseBearerToken(''), null);
		assert.equal(parseBearerToken('Bearer'), null);
		assert.equal(parseBearerToken('Basic abc123'), null);
		assert.equal(parseBearerToken('Bearer token extra'), null);
		assert.equal(parseBearerToken('Bearer test-token'), 'test-token');
	});

	it('compares static tokens safely', () => {
		assert.equal(tokenEquals('abc123', 'abc123'), true);
		assert.equal(tokenEquals('abc123', 'abc124'), false);
		assert.equal(tokenEquals('short', 'longer'), false);
		assert.equal(hasStaticBearerToken('Bearer abc123', 'abc123'), true);
		assert.equal(hasStaticBearerToken('Bearer wrong', 'abc123'), false);
		assert.equal(hasStaticBearerToken('Basic abc123', 'abc123'), false);
	});
});
