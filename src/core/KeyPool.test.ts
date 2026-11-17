import { describe, expect, it } from 'vitest';

import { KeyPool, type KeyPoolEntry } from './KeyPool.js';

const T0 = 1_000_000;

function entry(id: string): KeyPoolEntry {
  return {
    id,
    value: `secret-${id}`,
    hint: `...${id}`,
  };
}

describe('KeyPool', () => {
  it('starts with all keys active and does not expose secret values in snapshots', () => {
    const pool = new KeyPool([entry('a'), entry('b')]);
    const snapshot = pool.snapshot(T0);

    expect(snapshot.total).toBe(2);
    expect(snapshot.available).toBe(2);
    expect(snapshot.nextAvailableAt).toBeNull();
    expect(snapshot.keys.map((key) => key.state)).toEqual(['active', 'active']);
    expect(snapshot.keys[0]).not.toHaveProperty('value');
  });

  it('rotates keys in round-robin order and wraps around', () => {
    const pool = new KeyPool([entry('a'), entry('b'), entry('c')]);

    expect(pool.acquire(T0)?.id).toBe('a');
    expect(pool.acquire(T0)?.id).toBe('b');
    expect(pool.acquire(T0)?.id).toBe('c');
    expect(pool.acquire(T0)?.id).toBe('a');
  });

  it('restores persisted cooldown and counters', () => {
    const pool = new KeyPool(
      [
        {
          ...entry('a'),
          failureCount: 2,
          cooldownUntil: T0 + 5_000,
          lastUsedAt: T0 - 1_000,
        },
        entry('b'),
      ],
      T0,
    );

    const snapshot = pool.snapshot(T0);

    expect(snapshot.keys[0]).toMatchObject({
      id: 'a',
      state: 'cooldown',
      failureCount: 2,
      cooldownUntil: T0 + 5_000,
      lastUsedAt: T0 - 1_000,
    });
    expect(snapshot.available).toBe(1);
    expect(snapshot.nextAvailableAt).toBe(T0 + 5_000);
    expect(pool.acquire(T0)?.id).toBe('b');
    expect(pool.acquire(T0 + 5_000)?.id).toBe('a');
  });

  it('treats an expired persisted cooldown as active', () => {
    const pool = new KeyPool(
      [{ ...entry('a'), failureCount: 3, cooldownUntil: T0 - 1 }],
      T0,
    );

    expect(pool.snapshot(T0).keys[0]).toMatchObject({
      state: 'active',
      failureCount: 3,
      cooldownUntil: null,
    });
    expect(pool.acquire(T0)?.id).toBe('a');
  });

  it('skips invalid keys', () => {
    const pool = new KeyPool([entry('a'), entry('b'), entry('c')]);

    pool.reportInvalid('b');

    expect(pool.acquire(T0)?.id).toBe('a');
    expect(pool.acquire(T0)?.id).toBe('c');
    expect(pool.acquire(T0)?.id).toBe('a');
  });

  it('skips keys in cooldown', () => {
    const pool = new KeyPool([entry('a'), entry('b')]);

    pool.reportRateLimit('a', 1_000, T0);

    expect(pool.acquire(T0)?.id).toBe('b');
    expect(pool.acquire(T0)?.id).toBe('b');
  });

  it('returns a key again after its cooldown expires', () => {
    const pool = new KeyPool([entry('a'), entry('b')]);

    pool.reportRateLimit('a', 1_000, T0);

    expect(pool.acquire(T0)?.id).toBe('b');
    expect(pool.acquire(T0 + 1_000)?.id).toBe('a');
  });

  it('returns null when all keys are cooling down', () => {
    const pool = new KeyPool([entry('a'), entry('b')]);

    pool.reportRateLimit('a', 1_000, T0);
    pool.reportRateLimit('b', 2_000, T0);

    expect(pool.acquire(T0)).toBeNull();

    const snapshot = pool.snapshot(T0);

    expect(snapshot.available).toBe(0);
    expect(snapshot.nextAvailableAt).toBe(T0 + 1_000);
  });

  it('returns null when all keys are invalid', () => {
    const pool = new KeyPool([entry('a'), entry('b')]);

    pool.reportInvalid('a');
    pool.reportInvalid('b');

    expect(pool.acquire(T0)).toBeNull();
    expect(pool.snapshot(T0).available).toBe(0);
  });

  it('clears cooldown and failures after a successful request', () => {
    const pool = new KeyPool([entry('a')]);

    pool.reportRateLimit('a', 1_000, T0);
    pool.reportSuccess('a', T0 + 100);

    const key = pool.snapshot(T0 + 100).keys[0];

    expect(key).toMatchObject({
      id: 'a',
      state: 'active',
      failureCount: 0,
      cooldownUntil: null,
      lastUsedAt: T0 + 100,
    });
  });

  it('increments failure count without changing the state', () => {
    const pool = new KeyPool([entry('a')]);

    pool.reportFailure('a');
    pool.reportFailure('a');

    const key = pool.snapshot(T0).keys[0];

    expect(key?.state).toBe('active');
    expect(key?.failureCount).toBe(2);
  });

  it('opens the circuit after the default failure threshold', () => {
    const pool = new KeyPool([entry('a'), entry('b')], T0);

    expect(pool.reportFailure('a', T0)).toEqual({ failureCount: 1 });
    expect(pool.reportFailure('a', T0)).toEqual({ failureCount: 2 });
    expect(pool.snapshot(T0).keys[0]?.state).toBe('active');

    const result = pool.reportFailure('a', T0);

    expect(result).toEqual({
      failureCount: 3,
      cooldownUntil: T0 + 60_000,
    });
    expect(pool.snapshot(T0).keys[0]).toMatchObject({
      state: 'cooldown',
      failureCount: 3,
      cooldownUntil: T0 + 60_000,
    });
    expect(pool.acquire(T0)?.id).toBe('b');
  });

  it('reopens after a half-open failure and closes on success', () => {
    const pool = new KeyPool([entry('a')], T0, {
      failureThreshold: 2,
      failureCooldownMs: 1_000,
    });

    pool.reportFailure('a', T0);
    pool.reportFailure('a', T0);

    expect(pool.acquire(T0)).toBeNull();
    expect(pool.acquire(T0 + 1_000)?.id).toBe('a');
    expect(pool.snapshot(T0 + 1_000).keys[0]).toMatchObject({
      state: 'active',
      failureCount: 2,
    });

    const reopened = pool.reportFailure('a', T0 + 1_000);

    expect(reopened.cooldownUntil).toBe(T0 + 2_000);
    expect(pool.acquire(T0 + 1_000)).toBeNull();

    expect(pool.acquire(T0 + 2_000)?.id).toBe('a');

    pool.reportSuccess('a', T0 + 2_100);

    expect(pool.snapshot(T0 + 2_100).keys[0]).toMatchObject({
      state: 'active',
      failureCount: 0,
      cooldownUntil: null,
    });
  });

  it('supports a custom failure threshold and cooldown', () => {
    const pool = new KeyPool([entry('a')], T0, {
      failureThreshold: 2,
      failureCooldownMs: 5_000,
    });

    expect(pool.reportFailure('a', T0).cooldownUntil).toBeUndefined();
    expect(pool.reportFailure('a', T0).cooldownUntil).toBe(T0 + 5_000);
  });

  it('rejects invalid circuit breaker options', () => {
    expect(
      () => new KeyPool([entry('a')], T0, { failureThreshold: 0 }),
    ).toThrow('failureThreshold must be a positive integer');

    expect(
      () => new KeyPool([entry('a')], T0, { failureCooldownMs: -1 }),
    ).toThrow('failureCooldownMs must be a non-negative integer');
  });

  it('increments usage count and records lastUsedAt on acquire', () => {
    const pool = new KeyPool([entry('a')]);

    const acquired = pool.acquire(T0);

    expect(acquired).toMatchObject({
      id: 'a',
      usageCount: 1,
      lastUsedAt: T0,
    });

    const key = pool.snapshot(T0).keys[0];

    expect(key?.usageCount).toBe(1);
    expect(key?.lastUsedAt).toBe(T0);
  });

  it('handles an empty pool', () => {
    const pool = new KeyPool([]);

    expect(pool.size).toBe(0);
    expect(pool.acquire(T0)).toBeNull();
    expect(pool.snapshot(T0)).toEqual({
      total: 0,
      available: 0,
      nextAvailableAt: null,
      keys: [],
    });
  });

  it('rejects duplicate key ids', () => {
    expect(() => new KeyPool([entry('a'), entry('a')])).toThrow(
      'Duplicate key id: a',
    );
  });

  it('rejects keys with an empty value', () => {
    expect(
      () => new KeyPool([{ id: 'a', value: '   ', hint: '...a' }]),
    ).toThrow('Key a has an empty value');
  });

  it('rejects reports for unknown key ids', () => {
    const pool = new KeyPool([entry('a')]);

    expect(() => pool.reportSuccess('missing')).toThrow(
      'Unknown key id: missing',
    );
  });
});
