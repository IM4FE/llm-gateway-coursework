import { describe, expect, it, vi } from 'vitest';

import { KeyPool } from './KeyPool.js';
import {
  PoolRegistry,
  type KeyPoolFactory,
} from './PoolRegistry.js';

function makePool(id: string): KeyPool {
  return new KeyPool([{ id, value: `secret-${id}`, hint: `...${id}` }]);
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('PoolRegistry', () => {
  it('creates a pool once and reuses it for the same provider', async () => {
    const pool = makePool('a');
    const factory = vi.fn<KeyPoolFactory>().mockResolvedValue(pool);
    const registry = new PoolRegistry(factory);

    await expect(registry.get('provider-1')).resolves.toBe(pool);
    await expect(registry.get('provider-1')).resolves.toBe(pool);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('provider-1');
    expect(registry.size).toBe(1);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const pool = makePool('a');
    const pending = deferred<KeyPool>();
    const factory = vi.fn<KeyPoolFactory>().mockReturnValue(pending.promise);
    const registry = new PoolRegistry(factory);

    const first = registry.get('provider-1');
    const second = registry.get('provider-1');

    expect(factory).toHaveBeenCalledTimes(1);

    pending.resolve(pool);

    await expect(first).resolves.toBe(pool);
    await expect(second).resolves.toBe(pool);
  });

  it('keeps pools for different providers separate', async () => {
    const first = makePool('a');
    const second = makePool('b');
    const factory = vi
      .fn<KeyPoolFactory>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = new PoolRegistry(factory);

    await expect(registry.get('provider-1')).resolves.toBe(first);
    await expect(registry.get('provider-2')).resolves.toBe(second);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(2);
  });

  it('does not cache a failed load', async () => {
    const pool = makePool('a');
    const factory = vi
      .fn<KeyPoolFactory>()
      .mockRejectedValueOnce(new Error('database is down'))
      .mockResolvedValueOnce(pool);
    const registry = new PoolRegistry(factory);

    await expect(registry.get('provider-1')).rejects.toThrow(
      'database is down',
    );
    expect(registry.size).toBe(0);

    await expect(registry.get('provider-1')).resolves.toBe(pool);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('refreshes a provider pool on demand', async () => {
    const first = makePool('a');
    const second = makePool('b');
    const factory = vi
      .fn<KeyPoolFactory>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const registry = new PoolRegistry(factory);

    await expect(registry.get('provider-1')).resolves.toBe(first);
    await expect(registry.refresh('provider-1')).resolves.toBe(second);
    await expect(registry.get('provider-1')).resolves.toBe(second);

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('clears one provider or the whole registry', async () => {
    const factory = vi
      .fn<KeyPoolFactory>()
      .mockResolvedValue(makePool('a'));
    const registry = new PoolRegistry(factory);

    await registry.get('provider-1');
    await registry.get('provider-2');
    expect(registry.size).toBe(2);

    registry.clear('provider-1');
    expect(registry.size).toBe(1);

    registry.clear();
    expect(registry.size).toBe(0);
  });
});
