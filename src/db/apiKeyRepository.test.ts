import { describe, expect, it, vi } from 'vitest';

import {
  encryptSecret,
  fingerprintSecret,
  hintSecret,
} from '../core/secrets.js';
import {
  ApiKeyRepository,
  type ApiKeyRow,
  type ApiKeyRowLoader,
} from './apiKeyRepository.js';

const KEY = Buffer.alloc(32, 7);
const KEY_BASE64 = KEY.toString('base64');
const OTHER_KEY_BASE64 = Buffer.alloc(32, 9).toString('base64');

function makeRow(id: string, value: string): ApiKeyRow {
  return {
    id,
    fingerprint: fingerprintSecret(value),
    keyHint: hintSecret(value),
    ...encryptSecret(value, KEY),
  };
}

describe('ApiKeyRepository', () => {
  it('loads and decrypts active keys in loader order', async () => {
    const rows = [
      makeRow('key-1', 'sk-or-v1-first'),
      makeRow('key-2', 'sk-or-v1-second'),
    ];
    const loader = vi.fn<ApiKeyRowLoader>().mockResolvedValue(rows);
    const repository = new ApiKeyRepository(loader, KEY_BASE64);

    const entries = await repository.listActive('provider-1');

    expect(loader).toHaveBeenCalledWith('provider-1');
    expect(entries).toEqual([
      { id: 'key-1', value: 'sk-or-v1-first', hint: '...irst' },
      { id: 'key-2', value: 'sk-or-v1-second', hint: '...cond' },
    ]);
  });

  it('creates a ready-to-use key pool', async () => {
    const loader = vi
      .fn<ApiKeyRowLoader>()
      .mockResolvedValue([
        makeRow('key-1', 'first-secret'),
        makeRow('key-2', 'second-secret'),
      ]);
    const repository = new ApiKeyRepository(loader, KEY_BASE64);

    const pool = await repository.createPool('provider-1');

    expect(pool.size).toBe(2);
    expect(pool.acquire()?.id).toBe('key-1');
    expect(pool.acquire()?.id).toBe('key-2');
  });

  it('creates an empty pool when the provider has no active keys', async () => {
    const loader = vi.fn<ApiKeyRowLoader>().mockResolvedValue([]);
    const repository = new ApiKeyRepository(loader, KEY_BASE64);

    const pool = await repository.createPool('provider-1');

    expect(pool.size).toBe(0);
    expect(pool.acquire()).toBeNull();
  });

  it('queries the loader on every call instead of caching stale keys', async () => {
    const loader = vi.fn<ApiKeyRowLoader>().mockResolvedValue([]);
    const repository = new ApiKeyRepository(loader, KEY_BASE64);

    await repository.listActive('provider-1');
    await repository.listActive('provider-1');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('rejects keys encrypted with a different master key', async () => {
    const loader = vi
      .fn<ApiKeyRowLoader>()
      .mockResolvedValue([makeRow('key-1', 'secret')]);
    const repository = new ApiKeyRepository(loader, OTHER_KEY_BASE64);

    await expect(repository.listActive('provider-1')).rejects.toThrow(
      'Failed to decrypt secret',
    );
  });

  it('rejects rows whose fingerprint does not match the decrypted value', async () => {
    const row = makeRow('key-1', 'secret');
    const loader = vi.fn<ApiKeyRowLoader>().mockResolvedValue([
      { ...row, fingerprint: fingerprintSecret('another-secret') },
    ]);
    const repository = new ApiKeyRepository(loader, KEY_BASE64);

    await expect(repository.listActive('provider-1')).rejects.toThrow(
      'Fingerprint mismatch for API key key-1',
    );
  });

  it('propagates database errors', async () => {
    const loader = vi
      .fn<ApiKeyRowLoader>()
      .mockRejectedValue(new Error('connection refused'));
    const repository = new ApiKeyRepository(loader, KEY_BASE64);

    await expect(repository.listActive('provider-1')).rejects.toThrow(
      'connection refused',
    );
  });

  it('rejects an invalid master key at construction time', () => {
    expect(
      () => new ApiKeyRepository(async () => [], 'not-a-32-byte-key'),
    ).toThrow('ENCRYPTION_KEY must decode to 32 bytes');
  });
});
