import { describe, expect, it, vi } from 'vitest';

import {
  RouteRepository,
  type RouteRow,
  type RouteRowLoader,
} from './routeRepository.js';

const row: RouteRow = {
  routeId: 'route-1',
  alias: 'fast-model',
  priority: 1,
  modelId: 'model-1',
  upstreamModel: 'meta-llama/llama-3.3-70b-instruct:free',
  providerId: 'provider-1',
  providerName: 'OpenRouter',
  providerType: 'openai_compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  timeoutMs: 30_000,
};

describe('RouteRepository', () => {
  it('returns routes from the loader for the requested alias', async () => {
    const loader = vi.fn<RouteRowLoader>().mockResolvedValue([row]);
    const repository = new RouteRepository(loader);

    const rows = await repository.listActiveByAlias('fast-model');

    expect(loader).toHaveBeenCalledWith('fast-model');
    expect(rows).toEqual([row]);
  });

  it('returns an empty list when the alias has no routes', async () => {
    const loader = vi.fn<RouteRowLoader>().mockResolvedValue([]);
    const repository = new RouteRepository(loader);

    await expect(repository.listActiveByAlias('missing')).resolves.toEqual([]);
  });

  it('propagates database errors', async () => {
    const loader = vi
      .fn<RouteRowLoader>()
      .mockRejectedValue(new Error('connection refused'));
    const repository = new RouteRepository(loader);

    await expect(repository.listActiveByAlias('fast-model')).rejects.toThrow(
      'connection refused',
    );
  });
});
