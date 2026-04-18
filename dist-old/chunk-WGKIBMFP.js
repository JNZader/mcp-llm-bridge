// src/core/logger.ts
import pino from "pino";
function createLogger(config = {}) {
  const envLevel = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  const level = config.level ?? envLevel;
  const pretty = config.pretty ?? process.env["NODE_ENV"] !== "production";
  if (pretty) {
    return pino({
      level,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
    });
  }
  return pino({ level });
}
var logger = createLogger();
function childLogger(bindings) {
  return logger.child(bindings);
}

export {
  logger,
  childLogger
};
