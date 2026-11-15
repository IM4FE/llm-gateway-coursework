import { describe, expect, it, vi } from 'vitest';

import {
  ClientRepository,
  type ClientRow,
  type ClientRowLoader,
} from './clientRepository.js';

const clientRow: ClientRow = {
  id: 'client-1',
  name: 'Postman',
  rateLimitRpm: 60,
  monthlyBudgetMicros: 0,
};

describe('ClientRepository', () => {
  it('returns the client loaded by key hash', async () => {
    const loader = vi.fn<ClientRowLoader>().mockResolvedValue(clientRow);
    const repository = new ClientRepository(loader);

    await expect(repository.findByKeyHash('hash-1')).resolves.toEqual(
      clientRow,
    );
    expect(loader).toHaveBeenCalledWith('hash-1');
  });

  it('returns undefined for an unknown hash', async () => {
    const loader = vi.fn<ClientRowLoader>().mockResolvedValue(undefined);
    const repository = new ClientRepository(loader);

    await expect(repository.findByKeyHash('missing')).resolves.toBeUndefined();
  });
});
