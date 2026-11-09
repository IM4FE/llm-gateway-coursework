export type KeyState = 'active' | 'cooldown' | 'invalid';

export interface KeyPoolEntry {
  id: string;
  value: string;
  hint: string;
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
  private cursor = 0;

  constructor(entries: ReadonlyArray<KeyPoolEntry>) {
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

    this.keys = entries.map((entry) => ({
      ...entry,
      state: 'active',
      usageCount: 0,
      failureCount: 0,
      cooldownUntil: undefined,
      lastUsedAt: undefined,
    }));
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
   * Увеличивает счётчик ошибок, не меняя состояние ключа.
   * Пригодится для circuit breaker и аналитики.
   */
  reportFailure(keyId: string): void {
    const key = this.getKey(keyId);
    key.failureCount += 1;
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
