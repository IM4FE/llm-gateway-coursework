import { createProviderAdapter } from './adapters/createProviderAdapter.js';
import { buildApp } from './app.js';
import { createClientAuthenticator } from './auth/clientAuth.js';
import { loadEnv } from './config/env.js';
import { PoolRegistry } from './core/PoolRegistry.js';
import { FixedWindowRateLimiter } from './core/RateLimiter.js';
import { Router } from './core/Router.js';
import { createApiKeyRepository } from './db/apiKeyRepository.js';
import { createDatabase } from './db/client.js';
import { createClientRepository } from './db/clientRepository.js';
import { createDeploymentResolver } from './routes/deploymentResolver.js';
import { createRouteRepository } from './routes/routeRepository.js';

const env = loadEnv();
const database = createDatabase(env);

const apiKeys = createApiKeyRepository(database.db, env.ENCRYPTION_KEY);
const pools = new PoolRegistry((providerId) => apiKeys.createPool(providerId));
const routes = createRouteRepository(database.db);
const clients = createClientRepository(database.db);
const authenticateClient = createClientAuthenticator(clients);
const rateLimiter = new FixedWindowRateLimiter();

const router = new Router(
  createDeploymentResolver({
    routes,
    pools,
    createAdapter: (row) =>
      createProviderAdapter(row.providerName, row.providerType),
    headersFor: (row) => {
      if (row.providerName !== 'OpenRouter') {
        return undefined;
      }

      const headers: Record<string, string> = {};

      if (env.OPENROUTER_REFERER !== undefined) {
        headers['HTTP-Referer'] = env.OPENROUTER_REFERER;
      }
      if (env.OPENROUTER_TITLE !== undefined) {
        headers['X-Title'] = env.OPENROUTER_TITLE;
      }

      return Object.keys(headers).length > 0 ? headers : undefined;
    },
  }),
);

const app = buildApp(env, { router, authenticateClient, rateLimiter });

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'shutting down');

  try {
    await app.close();
    await database.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'failed to shut down gracefully');
    process.exit(1);
  }
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error, 'failed to start the server');
  process.exit(1);
}
