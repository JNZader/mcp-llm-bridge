import { sanitizeErrorMessage } from '../core/error-sanitizer.js';

const DEFAULT_LOG_PAYLOAD_MAX_LENGTH = 10_000;

const BLOCKED_KEYS = new Set([
	'prompt',
	'system',
	'text',
	'content',
	'messages',
	'instruction',
	'context',
	'input',
	'output',
	'body',
	'delta',
	'requestData',
	'responseData',
]);

function stripSensitive(value: unknown, depth = 0): unknown {
	if (depth > 6 || value === undefined || value === null) {
		return value;
	}
	if (typeof value === 'string') {
		return depth === 0 ? undefined : value;
	}
	if (typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => stripSensitive(item, depth + 1)).filter((item) => item !== undefined);
	}

	const redacted: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (BLOCKED_KEYS.has(key)) {
			continue;
		}
		const next = stripSensitive(nested, depth + 1);
		if (next !== undefined) {
			redacted[key] = next;
		}
	}
	return redacted;
}

/** Serialize log data without persisting prompts, responses, or serialization errors. */
export function serializeLogPayload(
	data: unknown,
	maxLength = DEFAULT_LOG_PAYLOAD_MAX_LENGTH,
): string | undefined {
	if (data === undefined || data === null) {
		return undefined;
	}

	const limit = Math.max(0, Math.floor(maxLength));
	const safe = stripSensitive(data);
	if (safe === undefined || safe === null) {
		return undefined;
	}
	if (typeof safe === 'string') {
		return undefined;
	}

	try {
		const serialized = JSON.stringify(safe);
		if (typeof serialized !== 'string') {
			return undefined;
		}
		return sanitizeErrorMessage(serialized.slice(0, limit));
	} catch {
		return undefined;
	}
}
