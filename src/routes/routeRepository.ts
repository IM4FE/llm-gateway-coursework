import { and, asc, eq } from 'drizzle-orm';

import type { ProviderType } from '../core/types.js';
import type { Database } from '../db/client.js';
import { models, modelRoutes, providers } from '../db/schema.js';

/**
 * Плоская строка маршрута: alias + модель + провайдер.
 * Ровно то, что нужно для сборки RouterDeployment.
 */
export interface RouteRow {
  routeId: string;
  alias: string;
  priority: number;
  modelId: string;
  upstreamModel: string;
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  baseUrl: string;
  timeoutMs: number;
}

export type RouteRowLoader = (alias: string) => Promise<RouteRow[]>;

export interface RouteProvider {
  listActiveByAlias(alias: string): Promise<RouteRow[]>;
}

/**
 * Репозиторий маршрутов.
 *
 * Как и ApiKeyRepository, он получает загрузчик снаружи.
 * Это позволяет тестировать маппинг и resolver без PostgreSQL.
 */
export class RouteRepository implements RouteProvider {
  constructor(private readonly loadRows: RouteRowLoader) {}

  async listActiveByAlias(alias: string): Promise<RouteRow[]> {
    return this.loadRows(alias);
  }
}

/**
 * SQL-запрос поверх Drizzle.
 *
 * Условия:
 * - alias совпадает с запрошенным;
 * - маршрут, модель и провайдер активны;
 * - порядок детерминирован по priority и id.
 *
 * `weight` пока не используется: он понадобится для
 * взвешенного распределения внутри одного priority.
 */
export function createRouteRepository(db: Database): RouteRepository {
  return new RouteRepository(async (alias) => {
    return db
      .select({
        routeId: modelRoutes.id,
        alias: modelRoutes.alias,
        priority: modelRoutes.priority,
        modelId: models.id,
        upstreamModel: models.upstreamModel,
        providerId: providers.id,
        providerName: providers.name,
        providerType: providers.type,
        baseUrl: providers.baseUrl,
        timeoutMs: providers.timeoutMs,
      })
      .from(modelRoutes)
      .innerJoin(models, eq(modelRoutes.modelId, models.id))
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(
        and(
          eq(modelRoutes.alias, alias),
          eq(modelRoutes.isActive, true),
          eq(models.isActive, true),
          eq(providers.isActive, true),
        ),
      )
      .orderBy(asc(modelRoutes.priority), asc(modelRoutes.id));
  });
}
