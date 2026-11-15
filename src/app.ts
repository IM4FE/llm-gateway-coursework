import Fastify, { type FastifyInstance } from 'fastify';

import type { Env } from './config/env.js';
import {
  registerChatCompletionRoute,
  type ChatCompletionHandler,
} from './routes/chatCompletions.js';

export interface AppDependencies {
  router?: ChatCompletionHandler;
}

export function buildApp(
  env: Env,
  dependencies: AppDependencies = {},
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers.cookie',
        ],
        censor: '[redacted]',
      },
    },
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async () => ({
    status: 'ok',
    checks: {
      // The database check will be added together with the repository layer.
      database: 'not-checked',
    },
  }));

  registerChatCompletionRoute(app, dependencies);

  app.get('/', async () => ({
    name: 'llm-gateway',
    version: '0.1.0',
    endpoints: ['/health', '/ready', '/v1/chat/completions'],
  }));

  return app;
}
