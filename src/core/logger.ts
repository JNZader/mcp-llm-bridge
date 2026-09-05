/**
 * Structured logging with Pino.
 *
 * Provides a configurable logger that outputs JSON in production
 * and pretty-printed logs in development.
 */

import pino from 'pino';

/**
 * Log levels.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Logger configuration.
 */
export interface LoggerConfig {
  /** Log level (default: from LOG_LEVEL env or 'info') */
  level?: LogLevel;
  /** Enable pretty printing (default: true in development) */
  pretty?: boolean;
}

const SENSITIVE_LOG_PATHS = [
  'apiKey',
  'api_key',
  'authorization',
  'token',
  'password',
  'secret',
  'credential',
  'prompt',
  'response',
  'content',
  'err',
  'error',
  '*.apiKey',
  '*.api_key',
  '*.authorization',
  '*.token',
  '*.password',
  '*.secret',
  '*.credential',
  '*.prompt',
  '*.response',
  '*.content',
  '*.err',
  '*.error',
];

const LOG_OPTIONS = {
  redact: {
    paths: SENSITIVE_LOG_PATHS,
    censor: '[REDACTED]',
  },
} satisfies Pick<pino.LoggerOptions, 'redact'>;

/**
 * Create a configured logger instance.
 */
export function createLogger(
  config: LoggerConfig = {},
  destination?: pino.DestinationStream,
): pino.Logger {
  const envLevel = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as LogLevel;
  const level = config.level ?? envLevel;
  const pretty = config.pretty ?? process.env['NODE_ENV'] !== 'production';

  // All diagnostic logs MUST go to stderr (fd 2), NEVER stdout.
  // In MCP stdio mode, stdout is reserved exclusively for the JSON-RPC
  // protocol — any stray byte there corrupts the handshake. In HTTP mode
  // logs-on-stderr is the canonical, harmless choice. So: stderr always.
  if (pretty) {
    return pino({
      ...LOG_OPTIONS,
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          destination: 2,
        },
      },
    });
  }

  return pino({ ...LOG_OPTIONS, level }, destination ?? pino.destination(2));
}

/**
 * Default logger instance.
 * Uses LOG_LEVEL env var (default: 'info') and pretty mode in development.
 */
export const logger = createLogger();

/**
 * Create a child logger with additional context.
 */
export function childLogger(
  bindings: pino.Bindings,
  parent: pino.Logger = logger,
): pino.Logger {
  return parent.child(bindings);
}
