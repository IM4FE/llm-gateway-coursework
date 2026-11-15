import { describe, expect, it, vi } from 'vitest';

import { hashClientKey } from '../core/clientKeys.js';
import { GatewayError } from '../core/errors.js';
import {
  ClientRepository,
  type ClientRowLoader,
} from '../db/clientRepository.js';
import {
  createClientAuthenticator,
  parseBearerToken,
} from './clientAuth.js';

function repositoryWith(loader: ClientRowLoader): ClientRepository {
  return new ClientRepository(loader);
}

describe('parseBearerToken', () => {
  it.each([
    ['Bearer lgw_abc', 'lgw_abc'],
    ['bearer lgw_abc', 'lgw_abc'],
    ['  Bearer   lgw_abc  ', 'lgw_abc'],
  ])('parses %j', (header, expected) => {
    expect(parseBearerToken(header)).toBe(expected);
  });

  it.each([undefined, '', 'Bearer', 'Bearer   ', 'Basic abc', 'lgw_abc'])(
    'rejects %j',
    (header) => {
      expect(parseBearerToken(header)).toBeNull();
    },
  );
});

describe('createClientAuthenticator', () => {
  it('rejects a missing Authorization header', async () => {
    const loader = vi.fn<ClientRowLoader>();
    const authenticate = createClientAuthenticator(repositoryWith(loader));

    await expect(authenticate(undefined)).rejects.toMatchObject({
      code: 'unauthorized',
      httpStatus: 401,
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const loader = vi.fn<ClientRowLoader>();
    const authenticate = createClientAuthenticator(repositoryWith(loader));

    await expect(authenticate('Basic abc')).rejects.toBeInstanceOf(
      GatewayError,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('looks up the client by key hash, never by plaintext', async () => {
    const loader = vi.fn<ClientRowLoader>().mockResolvedValue(undefined);
    const authenticate = createClientAuthenticator(repositoryWith(loader));

    await expect(authenticate('Bearer lgw_secret')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Invalid client API key',
    });
    expect(loader).toHaveBeenCalledWith(hashClientKey('lgw_secret'));
    expect(loader).not.toHaveBeenCalledWith('lgw_secret');
  });

  it('returns the authenticated client', async () => {
    const loader = vi.fn<ClientRowLoader>().mockResolvedValue({
      id: 'client-1',
      name: 'Postman',
      rateLimitRpm: 60,
      monthlyBudgetMicros: 0,
    });
    const authenticate = createClientAuthenticator(repositoryWith(loader));

    await expect(authenticate('Bearer lgw_secret')).resolves.toEqual({
      id: 'client-1',
      name: 'Postman',
      rateLimitRpm: 60,
      monthlyBudgetMicros: 0,
    });
  });
});
