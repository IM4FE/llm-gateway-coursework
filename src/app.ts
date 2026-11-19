import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
} from 'fastify';
import type { Logger } from 'pino';

import type { ClientAuthenticator } from './auth/clientAuth.js';
import type { Env } from './config/env.js';
import type { RateLimiter } from './core/RateLimiter.js';
import type { RequestLogRepository } from './db/requestLogRepository.js';
import { createLogger } from './logger.js';
import { registerAdminRequestRoutes } from './routes/adminRequests.js';
import {
  registerChatCompletionRoute,
  type ChatCompletionHandler,
} from './routes/chatCompletions.js';

export interface AppDependencies {
  router?: ChatCompletionHandler;
  authenticateClient?: ClientAuthenticator;
  rateLimiter?: RateLimiter;
  requestLogs?: RequestLogRepository;
  logger?: Logger;
}

export function buildApp(
  env: Env,
  dependencies: AppDependencies = {},
): FastifyInstance {
  const loggerInstance: FastifyBaseLogger =
    dependencies.logger ?? createLogger(env);

  const app = Fastify({ loggerInstance });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async () => ({
    status: 'ok',
    checks: {
      // The database check will be added together with the repository layer.
      database: 'not-checked',
    },
  }));

  registerChatCompletionRoute(app, dependencies);
  registerAdminRequestRoutes(app, dependencies);

  app.get('/', async () => ({
    name: 'llm-gateway',
    version: '0.1.0',
    endpoints: [
      '/health',
      '/ready',
      '/v1/chat/completions',
      '/api/requests',
      '/api/requests/:requestId',
    ],
  }));

  return app;
}
