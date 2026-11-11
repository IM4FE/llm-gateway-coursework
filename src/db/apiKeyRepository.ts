import { and, asc, eq } from 'drizzle-orm';

import { KeyPool, type KeyPoolEntry } from '../core/KeyPool.js';
import {
  decodeEncryptionKey,
  decryptSecret,
  fingerprintSecret,
  type EncryptedSecret,
} from '../core/secrets.js';
import type { Database } from './client.js';
import { apiKeys } from './schema.js';

/**
 * Минимальный набор полей, который нужен для сборки ключа.
 * Отдельный тип позволяет тестировать репозиторий без реальной БД.
 */
export interface ApiKeyRow extends EncryptedSecret {
  id: string;
  fingerprint: string;
  keyHint: string;
}

export type ApiKeyRowLoader = (providerId: string) => Promise<ApiKeyRow[]>;

/**
 * Репозиторий ключей провайдера.
 *
 * Отвечает за две вещи:
 * 1. получает строки из БД;
 * 2. расшифровывает секреты и превращает их в `KeyPoolEntry`.
 *
 * Пул не знает, откуда взялись ключи, а репозиторий не знает,
 * как работает round-robin. Это разделение ответственности.
 */
export class ApiKeyRepository {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly loadRows: ApiKeyRowLoader,
    encryptionKeyBase64: string,
  ) {
    this.encryptionKey = decodeEncryptionKey(encryptionKeyBase64);
  }

  /**
   * Загружает активные ключи провайдера в порядке создания.
   *
   * Если ключ невозможно расшифровать или отпечаток не совпадает
   * с расшифрованным значением, выбрасывается ошибка. Молча
   * пропускать такие ключи опасно: это скрывает проблему
   * с `ENCRYPTION_KEY` или повреждение данных.
   */
  async listActive(providerId: string): Promise<KeyPoolEntry[]> {
    const rows = await this.loadRows(providerId);

    return rows.map((row) => {
      const value = decryptSecret(row, this.encryptionKey);

      if (fingerprintSecret(value) !== row.fingerprint) {
        throw new Error(
          `Fingerprint mismatch for API key ${row.id}: ` +
            'encrypted value does not match stored metadata',
        );
      }

      return {
        id: row.id,
        value,
        hint: row.keyHint,
      };
    });
  }

  /**
   * Создаёт готовый пул ключей для провайдера.
   */
  async createPool(providerId: string): Promise<KeyPool> {
    return new KeyPool(await this.listActive(providerId));
  }
}

/**
 * Собирает репозиторий поверх Drizzle.
 *
 * Запрос выбирает только активные ключи конкретного провайдера.
 * Сортировка по `created_at` и `id` делает порядок ключей
 * детерминированным: round-robin всегда стартует одинаково.
 */
export function createApiKeyRepository(
  db: Database,
  encryptionKeyBase64: string,
): ApiKeyRepository {
  return new ApiKeyRepository(async (providerId) => {
    const rows = await db
      .select({
        id: apiKeys.id,
        fingerprint: apiKeys.fingerprint,
        encryptedKey: apiKeys.encryptedKey,
        iv: apiKeys.iv,
        authTag: apiKeys.authTag,
        keyHint: apiKeys.keyHint,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.providerId, providerId),
          eq(apiKeys.isActive, true),
        ),
      )
      .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));

    return rows;
  }, encryptionKeyBase64);
}
