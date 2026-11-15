import { and, eq } from 'drizzle-orm';

import type { Database } from './client.js';
import { clients } from './schema.js';

/**
 * Безопасный набор полей клиента.
 *
 * Здесь нет `keyHash` и `keyPrefix`: HTTP-слою и Router'у они
 * не нужны, а чем меньше секретов ходит по коду, тем лучше.
 */
export interface ClientRow {
  id: string;
  name: string;
  rateLimitRpm: number;
  monthlyBudgetMicros: number;
}

export type ClientRowLoader = (
  keyHash: string,
) => Promise<ClientRow | undefined>;

/**
 * Репозиторий клиентов шлюза.
 *
 * Аутентификация сводится к одному запросу по хэшу ключа.
 * Отдельный loader позволяет тестировать логику без реальной БД.
 */
export class ClientRepository {
  constructor(private readonly loadRow: ClientRowLoader) {}

  async findByKeyHash(keyHash: string): Promise<ClientRow | undefined> {
    return this.loadRow(keyHash);
  }
}

/**
 * Собирает репозиторий поверх Drizzle.
 *
 * Ищем только активных клиентов: деактивация в админке должна
 * немедленно закрывать доступ, даже если ключ ещё у кого-то есть.
 */
export function createClientRepository(db: Database): ClientRepository {
  return new ClientRepository(async (keyHash) => {
    const [row] = await db
      .select({
        id: clients.id,
        name: clients.name,
        rateLimitRpm: clients.rateLimitRpm,
        monthlyBudgetMicros: clients.monthlyBudgetMicros,
      })
      .from(clients)
      .where(and(eq(clients.keyHash, keyHash), eq(clients.isActive, true)))
      .limit(1);

    return row;
  });
}
