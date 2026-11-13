import type { KeyPoolProvider } from '../core/PoolRegistry.js';
import type {
  DeploymentResolver,
  RouterDeployment,
} from '../core/Router.js';
import type { LLMProviderAdapter } from '../core/types.js';
import type { RouteProvider, RouteRow } from './routeRepository.js';

export type AdapterFactory = (row: RouteRow) => LLMProviderAdapter;

export interface DeploymentResolverOptions {
  routes: RouteProvider;
  pools: KeyPoolProvider;
  createAdapter: AdapterFactory;
  /**
   * Провайдер-специфичные заголовки. Для OpenRouter это,
   * например, HTTP-Referer и X-Title.
   */
  headersFor?: (row: RouteRow) => Record<string, string> | undefined;
}

/**
 * Собирает RouterDeployment из строк маршрутов.
 *
 * Resolver — это граница между БД и Router:
 * - RouteRepository отдаёт плоские строки;
 * - PoolRegistry даёт пул ключей провайдера;
 * - AdapterFactory создаёт нужный адаптер;
 * - Router получает уже готовые deployment'ы.
 */
export function createDeploymentResolver(
  options: DeploymentResolverOptions,
): DeploymentResolver {
  return async (alias) => {
    const rows = await options.routes.listActiveByAlias(alias);

    return Promise.all(
      rows.map(async (row): Promise<RouterDeployment> => {
        const headers = options.headersFor?.(row);

        return {
          providerId: row.providerId,
          upstreamModel: row.upstreamModel,
          priority: row.priority,
          adapter: options.createAdapter(row),
          keyPool: await options.pools.get(row.providerId),
          baseUrl: row.baseUrl,
          timeoutMs: row.timeoutMs,
          ...(headers !== undefined ? { headers } : {}),
        };
      }),
    );
  };
}
