export type KeyState = 'active' | 'cooldown' | 'invalid';

export interface KeyPoolOptions {
  /**
   * Сколько подряд ошибок ключа (кроме 429/401/403) нужно,
   * чтобы открыть circuit breaker и отправить ключ в cooldown.
   */
  failureThreshold?: number;
  /**
   * На сколько миллисекунд ключ исключается после открытия breaker'а.
   */
  failureCooldownMs?: number;
}

export interface KeyFailureResult {
  failureCount: number;
  /**
   * Заполняется, если breaker открылся: до какого момента
   * ключ не будет выдаваться.
   */
  cooldownUntil?: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_FAILURE_COOLDOWN_MS = 60_000;

export interface KeyPoolEntry {
  id: string;
  value: string;
  hint: string;
  /**
   * Состояние, загруженное из БД. Поля необязательны:
   * новый ключ ещё не имеет истории использования.
   */
  failureCount?: number;
  cooldownUntil?: number | undefined;
  lastUsedAt?: number | undefined;
}

export interface ProviderKey extends KeyPoolEntry {
  state: KeyState;
  usageCount: number;
  failureCount: number;
  cooldownUntil: number | undefined;
  lastUsedAt: number | undefined;
}

export interface KeyPoolSnapshotEntry {
  id: string;
  hint: string;
  state: KeyState;
  usageCount: number;
  failureCount: number;
  cooldownUntil: number | null;
  lastUsedAt: number | null;
}

export interface KeyPoolSnapshot {
  total: number;
  available: number;
  nextAvailableAt: number | null;
  keys: KeyPoolSnapshotEntry[];
}

/**
 * Пул ключей одного провайдера.
 *
 * Задача пула — выдавать следующий доступный ключ по кругу и временно
 * исключать ключи, которые получили 429 или были признаны невалидными.
 *
 * Пул ничего не знает про HTTP и провайдеров: он работает только с ключами.
 * Время передаётся параметром `now`, чтобы логику было легко тестировать
 * без реальных таймеров.
 */
export class KeyPool {
  private readonly keys: ProviderKey[];
  private readonly failureThreshold: number;
  private readonly failureCooldownMs: number;
  private cursor = 0;

  constructor(
    entries: ReadonlyArray<KeyPoolEntry>,
    now: number = Date.now(),
    options: KeyPoolOptions = {},
  ) {
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.failureCooldownMs =
      options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;

    if (
      !Number.isInteger(this.failureThreshold) ||
      this.failureThreshold < 1
    ) {
      throw new Error('failureThreshold must be a positive integer');
    }

    if (
      !Number.isInteger(this.failureCooldownMs) ||
      this.failureCooldownMs < 0
    ) {
      throw new Error('failureCooldownMs must be a non-negative integer');
    }

    const ids = new Set<string>();

    for (const entry of entries) {
      if (ids.has(entry.id)) {
        throw new Error(`Duplicate key id: ${entry.id}`);
      }
      if (entry.value.trim() === '') {
        throw new Error(`Key ${entry.id} has an empty value`);
      }
      ids.add(entry.id);
    }

    this.keys = entries.map((entry) => {
      const cooldownUntil =
        entry.cooldownUntil !== undefined && entry.cooldownUntil > now
          ? entry.cooldownUntil
          : undefined;

      return {
        id: entry.id,
        value: entry.value,
        hint: entry.hint,
        state: cooldownUntil === undefined ? 'active' : 'cooldown',
        usageCount: 0,
        failureCount: entry.failureCount ?? 0,
        cooldownUntil,
        lastUsedAt: entry.lastUsedAt,
      };
    });
  }

  get size(): number {
    return this.keys.length;
  }

  /**
   * Возвращает следующий доступный ключ по round-robin.
   * `null` означает, что сейчас нет ни одного активного ключа:
   * все либо в cooldown, либо помечены невалидными.
   */
  acquire(now: number = Date.now()): ProviderKey | null {
    if (this.keys.length === 0) {
      return null;
    }

    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const index = (this.cursor + offset) % this.keys.length;
      const key = this.keys[index]!;

      this.refreshCooldown(key, now);

      if (key.state !== 'active') {
        continue;
      }

      this.cursor = (index + 1) % this.keys.length;
      key.usageCount += 1;
      key.lastUsedAt = now;

      // Возвращаем копию, чтобы вызывающий код не мог случайно
      // изменить внутреннее состояние пула.
      return { ...key };
    }

    return null;
  }

  reportSuccess(keyId: string, now: number = Date.now()): void {
    const key = this.getKey(keyId);

    key.state = 'active';
    key.failureCount = 0;
    key.cooldownUntil = undefined;
    key.lastUsedAt = now;
  }

  /**
   * Переводит ключ в cooldown после 429.
   */
  reportRateLimit(
    keyId: string,
    cooldownMs: number,
    now: number = Date.now(),
  ): void {
    const key = this.getKey(keyId);

    key.state = 'cooldown';
    key.failureCount += 1;
    key.cooldownUntil = now + Math.max(0, cooldownMs);
  }

  /**
   * Помечает ключ невалидным после 401/403.
   * Такой ключ больше не будет выдаваться.
   */
  reportInvalid(keyId: string): void {
    const key = this.getKey(keyId);

    key.state = 'invalid';
    key.cooldownUntil = undefined;
  }

  /**
   * Увеличивает счётчик ошибок ключа и открывает circuit breaker,
   * когда достигнут порог.
   *
   * Пока breaker открыт, ключ находится в состоянии `cooldown`
   * и не выдаётся из пула. После истечения cooldown ключ снова
   * становится активным: это half-open-состояние. Если следующий
   * запрос снова завершится ошибкой, счётчик уже выше порога,
   * поэтому breaker мгновенно откроется ещё раз. Успех сбрасывает
   * `failureCount` и закрывает breaker.
   */
  reportFailure(
    keyId: string,
    now: number = Date.now(),
  ): KeyFailureResult {
    const key = this.getKey(keyId);

    key.failureCount += 1;

    if (key.failureCount >= this.failureThreshold) {
      key.state = 'cooldown';
      key.cooldownUntil = now + this.failureCooldownMs;

      return {
        failureCount: key.failureCount,
        cooldownUntil: key.cooldownUntil,
      };
    }

    return { failureCount: key.failureCount };
  }

  /**
   * Снимок состояния без секретных значений ключей.
   * Удобно для логов, админки и тестов.
   */
  snapshot(now: number = Date.now()): KeyPoolSnapshot {
    const keys = this.keys.map((key) => {
      this.refreshCooldown(key, now);

      return {
        id: key.id,
        hint: key.hint,
        state: key.state,
        usageCount: key.usageCount,
        failureCount: key.failureCount,
        cooldownUntil: key.cooldownUntil ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      };
    });

    const available = keys.filter((key) => key.state === 'active').length;

    const nextAvailableAt = keys.reduce<number | null>((min, key) => {
      if (key.state !== 'cooldown' || key.cooldownUntil === null) {
        return min;
      }

      return min === null ? key.cooldownUntil : Math.min(min, key.cooldownUntil);
    }, null);

    return {
      total: keys.length,
      available,
      nextAvailableAt,
      keys,
    };
  }

  private getKey(keyId: string): ProviderKey {
    const key = this.keys.find((candidate) => candidate.id === keyId);

    if (!key) {
      throw new Error(`Unknown key id: ${keyId}`);
    }

    return key;
  }

  private refreshCooldown(key: ProviderKey, now: number): void {
    if (
      key.state === 'cooldown' &&
      key.cooldownUntil !== undefined &&
      key.cooldownUntil <= now
    ) {
      key.state = 'active';
      key.cooldownUntil = undefined;
    }
  }
}
