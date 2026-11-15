import { createHash, randomBytes } from 'node:crypto';

const KEY_PREFIX = 'lgw_';
const KEY_BYTES = 32;
const DEFAULT_STORED_PREFIX_LENGTH = 12;
const MAX_STORED_PREFIX_LENGTH = 16;

/**
 * Клиентский ключ — это высокоэнтропийный случайный секрет,
 * а не пароль пользователя. Поэтому для хранения достаточно
 * обычного SHA-256: перебирать 256 бит энтропии бессмысленно.
 *
 * Префикс `lgw_` делает ключ узнаваемым: если он попадёт в лог
 * или репозиторий, сразу видно, что это ключ LLM Gateway.
 */
export function generateClientKey(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
}

/**
 * Стабильный хэш ключа для поиска в БД.
 *
 * В таблице `clients` хранится только `key_hash`, поэтому утечка
 * дампа БД не даёт готовых ключей.
 */
export function hashClientKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Короткий префикс для админки и логов: по нему клиент узнаваем,
 * но восстановить сам ключ нельзя.
 */
export function clientKeyPrefix(
  value: string,
  length: number = DEFAULT_STORED_PREFIX_LENGTH,
): string {
  if (
    !Number.isInteger(length) ||
    length < 1 ||
    length > MAX_STORED_PREFIX_LENGTH
  ) {
    throw new Error(
      `Prefix length must be between 1 and ${MAX_STORED_PREFIX_LENGTH}`,
    );
  }

  return value.slice(0, length);
}
