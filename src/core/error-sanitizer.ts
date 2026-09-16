const MAX_ERROR_MESSAGE_LENGTH = 4096;

const BEARER_SECRET_PATTERN = /Bearer\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"',}\]]+)/gi;
const TOKEN_FIELD_PATTERN =
  /((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|secret)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/gi;

/** Redact credential-like values while keeping the error useful and bounded. */
export function sanitizeErrorMessage(message: string): string {
  const bounded = message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return bounded
    .replace(BEARER_SECRET_PATTERN, 'Bearer [REDACTED]')
    .replace(TOKEN_FIELD_PATTERN, '$1[REDACTED]');
}

export function sanitizeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(sanitizeErrorMessage(message));
}
