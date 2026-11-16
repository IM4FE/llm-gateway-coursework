import pino, { type Logger } from 'pino';

import type { Env } from './config/env.js';

/**
 * Общий логгер приложения.
 *
 * Он создаётся до Fastify, потому что нужен не только HTTP-слою:
 * например, для ошибок сохранения состояния ключей. Fastify
 * получает этот же экземпляр через `loggerInstance`.
 */
export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'req.headers.cookie',
      ],
      censor: '[redacted]',
    },
  });
}
