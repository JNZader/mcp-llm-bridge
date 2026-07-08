import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { GenerateRequest as GenerateRequestBody } from '../src/core/schemas.js';
import { prepareGenerateRequest } from '../src/server/http-helpers/generate-request.js';
import type { RequestScope } from '../src/server/http-helpers/request-scope.js';

function createContext(headerProject?: string): RequestScope {
	return {
		project: headerProject,
	};
}

describe('prepareGenerateRequest', () => {
	it('prefers body project and preserves router.generate fields', () => {
		const validated: GenerateRequestBody = {
			prompt: 'hello',
			model: 'gpt-4o',
			provider: 'openai',
			maxTokens: 123,
			strict: true,
			project: 'body-project',
		};

		assert.deepEqual(prepareGenerateRequest(validated, createContext('header-project')), {
			prompt: 'hello',
			system: undefined,
			model: 'gpt-4o',
			provider: 'openai',
			maxTokens: 123,
			strict: true,
			project: 'body-project',
			apiKeyId: undefined,
			userId: undefined,
		});
	});

	it('composes context and instruction while preserving explicit system', () => {
		const validated: GenerateRequestBody = {
			prompt: 'ignored',
			system: 'Keep this system',
			context: 'Project uses React 19',
			instruction: 'Explain compiler behavior',
		};

		assert.deepEqual(prepareGenerateRequest(validated, createContext('header-project')), {
			prompt: '[Context]\nProject uses React 19\n\n[Instruction]\nExplain compiler behavior',
			system: 'Keep this system',
			model: undefined,
			provider: undefined,
			maxTokens: undefined,
			strict: undefined,
			project: 'header-project',
			apiKeyId: undefined,
			userId: undefined,
		});
	});

	it('optimizes flat prompts only when there is no explicit system', () => {
		const optimized = prepareGenerateRequest(
			{ prompt: 'You are a helpful assistant.\n\nTask: Explain useMemo.' },
			createContext(),
		);

		assert.equal(optimized.system, 'You are a helpful assistant.');
		assert.equal(optimized.prompt, '[Instruction]\nTask: Explain useMemo.');

		const preserved = prepareGenerateRequest(
			{
				prompt: 'You are a helpful assistant.\n\nTask: Explain useMemo.',
				system: 'Explicit system',
			},
			createContext(),
		);

		assert.equal(preserved.system, 'Explicit system');
		assert.equal(
			preserved.prompt,
			'You are a helpful assistant.\n\nTask: Explain useMemo.',
		);
	});
});
