import { describe, expect, it } from 'vitest';

import type { Database } from './client.js';
import { createKeyStateRepository } from './keyStateRepository.js';

const T0 = 1_000_000;

interface UpdateCall {
  set: Record<string, unknown>;
  where: unknown;
}

interface FakeDatabase {
  db: Database;
  updates: UpdateCall[];
}

function makeFakeDatabase(options: { error?: Error } = {}): FakeDatabase {
  const updates: UpdateCall[] = [];

  const db = {
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          if (options.error !== undefined) {
            throw options.error;
          }

          updates.push({ set: values, where: condition });
        },
      }),
    }),
  } as unknown as Database;

  return { db, updates };
}

describe('createKeyStateRepository', () => {
  it('resets failures and cooldown after a successful request', async () => {
    const fake = makeFakeDatabase();
    const repository = createKeyStateRepository(fake.db);

    await repository.record({
      keyId: 'key-1',
      type: 'success',
      at: T0,
    });

    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]!.set).toMatchObject({
      failureCount: 0,
      cooldownUntil: null,
      lastUsedAt: new Date(T0),
      updatedAt: new Date(T0),
    });
  });

  it('stores cooldown and increments failures after a rate limit', async () => {
    const fake = makeFakeDatabase();
    const repository = createKeyStateRepository(fake.db);

    await repository.record({
      keyId: 'key-1',
      type: 'rate_limited',
      at: T0,
      cooldownUntil: T0 + 60_000,
    });

    const set = fake.updates[0]!.set;

    expect(set).toMatchObject({
      cooldownUntil: new Date(T0 + 60_000),
      lastUsedAt: new Date(T0),
      updatedAt: new Date(T0),
    });
    expect(set.failureCount).toBeDefined();
  });

  it('deactivates a key after 401/403', async () => {
    const fake = makeFakeDatabase();
    const repository = createKeyStateRepository(fake.db);

    await repository.record({
      keyId: 'key-1',
      type: 'invalid',
      at: T0,
    });

    const set = fake.updates[0]!.set;

    expect(set).toMatchObject({
      isActive: false,
      cooldownUntil: null,
      lastUsedAt: new Date(T0),
      updatedAt: new Date(T0),
    });
    expect(set.failureCount).toBeDefined();
  });

  it('increments failures without touching cooldown or active flag', async () => {
    const fake = makeFakeDatabase();
    const repository = createKeyStateRepository(fake.db);

    await repository.record({
      keyId: 'key-1',
      type: 'failure',
      at: T0,
    });

    const set = fake.updates[0]!.set;

    expect(set).not.toHaveProperty('cooldownUntil');
    expect(set).not.toHaveProperty('isActive');
    expect(set).toMatchObject({
      lastUsedAt: new Date(T0),
      updatedAt: new Date(T0),
    });
    expect(set.failureCount).toBeDefined();
  });

  it('propagates database errors', async () => {
    const fake = makeFakeDatabase({
      error: new Error('connection refused'),
    });
    const repository = createKeyStateRepository(fake.db);

    await expect(
      repository.record({ keyId: 'key-1', type: 'success', at: T0 }),
    ).rejects.toThrow('connection refused');
  });
});
