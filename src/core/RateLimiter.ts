export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /**
   * Сколько секунд ждать до сброса окна.
   * Для разрешённого запроса равно 0.
   */
  retryAfterSeconds: number;
  /**
   * Момент сброса окна в epoch-миллисекундах.
   * HTTP-слой переводит его в Unix-секунды для заголовка X-RateLimit-Reset.
   */
  resetAt: number;
}

export interface RateLimiter {
  check(key: string, limit: number, now?: number): RateLimitDecision;
}

export interface FixedWindowRateLimiterOptions {
  windowMs?: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

const DEFAULT_WINDOW_MS = 60_000;

/**
 * Rate limiter с фиксированным окном.
 *
 * Почему фиксированное окно:
 * - просто и предсказуемо;
 * - не требует хранить историю каждого запроса;
 * - для учебного шлюза этого достаточно.
 *
 * Ограничение подхода: на границе окон возможен всплеск до 2×limit
 * (например, 60 запросов в конце минуты и ещё 60 в начале следующей).
 * Для более строгого контроля нужен sliding window или token bucket.
 *
 * Состояние хранится в памяти процесса. При нескольких инстансах
 * шлюза каждый будет считать свой лимит; для горизонтального
 * масштабирования счётчики нужно вынести в Redis.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private lastSweepAt = 0;

  constructor(options: FixedWindowRateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

    if (!Number.isInteger(this.windowMs) || this.windowMs < 1) {
      throw new Error('windowMs must be a positive integer');
    }
  }

  check(
    key: string,
    limit: number,
    now: number = Date.now(),
  ): RateLimitDecision {
    if (key.length === 0) {
      throw new Error('key must not be empty');
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('limit must be a positive integer');
    }

    if (!Number.isFinite(now)) {
      throw new Error('now must be a finite number');
    }

    this.sweep(now);

    const bucket = this.buckets.get(key);

    if (bucket === undefined || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });

      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        retryAfterSeconds: 0,
        resetAt: now + this.windowMs,
      };
    }

    const resetAt = bucket.windowStart + this.windowMs;

    if (bucket.count >= limit) {
      const retryAfterMs = resetAt - now;

      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
        resetAt,
      };
    }

    bucket.count += 1;

    return {
      allowed: true,
      limit,
      remaining: limit - bucket.count,
      retryAfterSeconds: 0,
      resetAt,
    };
  }

  /**
   * Ленивая очистка: не чаще одного раза за окно удаляем
   * просроченные buckets. Без неё Map рос бы вместе с числом
   * клиентов, которые когда-либо обращались к шлюзу.
   */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.windowMs) {
      return;
    }

    this.lastSweepAt = now;

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
