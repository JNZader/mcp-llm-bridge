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

/**
 * Create a configured logger instance.
 */
export function createLogger(config: LoggerConfig = {}): pino.Logger {
  const envLevel = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as LogLevel;
  const level = config.level ?? envLevel;
  const pretty = config.pretty ?? process.env['NODE_ENV'] !== 'production';

  if (pretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({ level });
}

/**
 * Default logger instance.
 * Uses LOG_LEVEL env var (default: 'info') and pretty mode in development.
 */
export const logger = createLogger();

/**
 * Create a child logger with additional context.
 */
export function childLogger(bindings: pino.Bindings): pino.Logger {
  return logger.child(bindings);
}
