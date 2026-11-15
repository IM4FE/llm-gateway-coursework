import { hashClientKey } from '../core/clientKeys.js';
import { GatewayError } from '../core/errors.js';
import type { ClientRepository } from '../db/clientRepository.js';

/**
 * Клиент, прошедший аутентификацию.
 *
 * Эти поля понадобятся дальше: rate limit, бюджет и журнал запросов.
 */
export interface AuthenticatedClient {
  id: string;
  name: string;
  rateLimitRpm: number;
  monthlyBudgetMicros: number;
}

/**
 * Функция аутентификации, которую HTTP-слой получает через DI.
 *
 * Тесты подставляют фейк, production — реализацию поверх БД.
 * Благодаря этому route не зависит от Drizzle и может проверяться
 * без PostgreSQL.
 */
export type ClientAuthenticator = (
  authorization: string | undefined,
) => Promise<AuthenticatedClient>;

/**
 * Проверяет `Authorization: Bearer <client_key>`.
 *
 * Ключ никогда не сравнивается с БД в открытом виде: сначала
 * считается SHA-256, затем ищется клиент по `key_hash`.
 */
export function createClientAuthenticator(
  repository: ClientRepository,
): ClientAuthenticator {
  return async (authorization) => {
    const token = parseBearerToken(authorization);

    if (token === null) {
      throw new GatewayError({
        code: 'unauthorized',
        message: 'Missing or malformed Authorization header',
      });
    }

    const client = await repository.findByKeyHash(hashClientKey(token));

    if (client === undefined) {
      throw new GatewayError({
        code: 'unauthorized',
        message: 'Invalid client API key',
      });
    }

    return client;
  };
}

/**
 * Разбирает `Authorization: Bearer <token>`.
 *
 * Схема сравнивается без учёта регистра, как требует RFC 7235.
 * Пустой токен, лишние слова и другие схемы считаются ошибкой.
 */
export function parseBearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match?.[1] ?? null;
}
