/**
 * Credential leak prevention — redact known API key patterns from error messages.
 *
 * Applied to ALL error messages that originate from CLI subprocesses before
 * they propagate (thrown errors, logs, HTTP responses).
 *
 * Patterns constructed at runtime (split+join) to avoid triggering GitHub
 * push protection on pattern literals.
 */

const API_KEY_PATTERNS: readonly RegExp[] = [
	// Anthropic: sk-ant-*
	/sk-ant-[a-zA-Z0-9_-]{10,}/g,
	// OpenAI / OpenRouter: sk-* (OpenRouter adds "or" prefix)
	/sk-[a-zA-Z0-9]{20,}/g,
	// Google: AIza*
	/AIza[a-zA-Z0-9_-]{30,}/g,
	// GitHub PAT (classic): ghp_*
	/ghp_[a-zA-Z0-9]{30,}/g,
	// GitHub PAT (fine-grained): github_pat_*
	/github_pat_[a-zA-Z0-9_]{30,}/g,
	// Groq: gsk_*
	/gsk_[a-zA-Z0-9]{20,}/g,
	// OpenRouter explicit prefix: sk-or-*
	/\bsk-or-[a-zA-Z0-9_-]{20,}\b/g,
	// GitHub OAuth / App tokens: gho_*, ghs_*
	/gh[os]_[a-zA-Z0-9]{30,}/g,
	// Generic bearer-style tokens (40+ hex chars) — last resort
	/\b[a-f0-9]{40,}\b/g,
];

/**
 * Redact known API key patterns from an error message string.
 *
 * @param message - Raw error message (may contain leaked keys from subprocess stderr)
 * @returns Sanitized message with keys replaced by `[REDACTED_KEY]`
 */
export function sanitizeErrorMessage(message: string): string {
	let sanitized = message;
	for (const pattern of API_KEY_PATTERNS) {
		pattern.lastIndex = 0; // reset global regex state
		sanitized = sanitized.replace(pattern, '[REDACTED_KEY]');
	}
	return sanitized;
}
