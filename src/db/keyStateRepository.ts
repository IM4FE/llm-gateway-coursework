import { eq, sql } from 'drizzle-orm';

import type { KeyStateEvent } from '../core/keyState.js';
import type { Database } from './client.js';
import { apiKeys } from './schema.js';

/**
 * Запись состояния ключей в БД.
 *
 * Интерфейс намеренно узкий: Router сообщает только факт события,
 * а SQL-детали остаются в репозитории.
 */
export interface KeyStateRepository {
  record(event: KeyStateEvent): Promise<void>;
}

/**
 * Сохраняет изменение состояния ключа.
 *
 * `failure_count` увеличивается атомарно через SQL, а не через
 * «прочитали число, прибавили единицу, записали». Иначе два
 * одновременных запроса могли бы потерять один инкремент.
 */
export function createKeyStateRepository(
  db: Database,
): KeyStateRepository {
  return {
    async record(event: KeyStateEvent): Promise<void> {
      const at = new Date(event.at);

      switch (event.type) {
        case 'success':
          await db
            .update(apiKeys)
            .set({
              failureCount: 0,
              cooldownUntil: null,
              lastUsedAt: at,
              updatedAt: at,
            })
            .where(eq(apiKeys.id, event.keyId));
          return;

        case 'rate_limited':
          await db
            .update(apiKeys)
            .set({
              failureCount: sql`${apiKeys.failureCount} + 1`,
              cooldownUntil: new Date(event.cooldownUntil ?? event.at),
              lastUsedAt: at,
              updatedAt: at,
            })
            .where(eq(apiKeys.id, event.keyId));
          return;

        case 'invalid':
          await db
            .update(apiKeys)
            .set({
              isActive: false,
              failureCount: sql`${apiKeys.failureCount} + 1`,
              cooldownUntil: null,
              lastUsedAt: at,
              updatedAt: at,
            })
            .where(eq(apiKeys.id, event.keyId));
          return;

        case 'failure':
          await db
            .update(apiKeys)
            .set({
              failureCount: sql`${apiKeys.failureCount} + 1`,
              ...(event.cooldownUntil !== undefined
                ? { cooldownUntil: new Date(event.cooldownUntil) }
                : {}),
              lastUsedAt: at,
              updatedAt: at,
            })
            .where(eq(apiKeys.id, event.keyId));
      }
    },
  };
}
