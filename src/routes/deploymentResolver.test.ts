import { describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleAdapter } from '../adapters/OpenAICompatibleAdapter.js';
import { KeyPool } from '../core/KeyPool.js';
import {
  createDeploymentResolver,
  type AdapterFactory,
} from './deploymentResolver.js';
import type { RouteProvider, RouteRow } from './routeRepository.js';

function makePool(id: string): KeyPool {
  return new KeyPool([{ id, value: `secret-${id}`, hint: `...${id}` }]);
}

function routeRow(overrides: Partial<RouteRow> = {}): RouteRow {
  return {
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
    ...overrides,
  };
}

function makeRoutes(rows: RouteRow[]) {
  const listActiveByAlias = vi
    .fn<RouteProvider['listActiveByAlias']>()
    .mockResolvedValue(rows);

  return {
    routes: { listActiveByAlias },
    listActiveByAlias,
  };
}

function makePools(pool: KeyPool) {
  const get = vi
    .fn<(providerId: string) => Promise<KeyPool>>()
    .mockResolvedValue(pool);

  return {
    pools: { get },
    get,
  };
}

describe('createDeploymentResolver', () => {
  it('maps route rows to router deployments', async () => {
    const row = routeRow();
    const adapter = new OpenAICompatibleAdapter('OpenRouter');
    const createAdapter = vi.fn<AdapterFactory>().mockReturnValue(adapter);
    const pool = makePool('a');
    const { routes, listActiveByAlias } = makeRoutes([row]);
    const { pools, get } = makePools(pool);

    const resolve = createDeploymentResolver({
      routes,
      pools,
      createAdapter,
    });

    const deployments = await resolve('fast-model');

    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({
      providerId: 'provider-1',
      upstreamModel: 'meta-llama/llama-3.3-70b-instruct:free',
      priority: 1,
      baseUrl: 'https://openrouter.ai/api/v1',
      timeoutMs: 30_000,
    });
    expect(deployments[0]!.adapter).toBe(adapter);
    expect(deployments[0]!.keyPool).toBe(pool);

    expect(listActiveByAlias).toHaveBeenCalledWith('fast-model');
    expect(createAdapter).toHaveBeenCalledWith(row);
    expect(get).toHaveBeenCalledWith('provider-1');
  });

  it('preserves route order and priorities', async () => {
    const rows = [
      routeRow({
        routeId: 'route-2',
        providerId: 'provider-2',
        providerName: 'Groq',
        priority: 2,
      }),
      routeRow({
        routeId: 'route-1',
        providerId: 'provider-1',
        providerName: 'OpenRouter',
        priority: 1,
      }),
    ];
    const adapter = new OpenAICompatibleAdapter('Mock');
    const createAdapter = vi.fn<AdapterFactory>().mockReturnValue(adapter);
    const { routes } = makeRoutes(rows);
    const { pools } = makePools(makePool('a'));

    const deployments = await createDeploymentResolver({
      routes,
      pools,
      createAdapter,
    })('fast-model');

    expect(deployments.map((deployment) => deployment.providerId)).toEqual([
      'provider-2',
      'provider-1',
    ]);
    expect(deployments.map((deployment) => deployment.priority)).toEqual([
      2, 1,
    ]);
  });

  it('adds provider-specific headers when configured', async () => {
    const row = routeRow();
    const adapter = new OpenAICompatibleAdapter('OpenRouter');
    const { routes } = makeRoutes([row]);
    const { pools } = makePools(makePool('a'));

    const deployments = await createDeploymentResolver({
      routes,
      pools,
      createAdapter: () => adapter,
      headersFor: () => ({
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'LLM Gateway Coursework',
      }),
    })('fast-model');

    expect(deployments[0]?.headers).toEqual({
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'LLM Gateway Coursework',
    });
  });

  it('omits headers when the hook returns undefined', async () => {
    const row = routeRow();
    const adapter = new OpenAICompatibleAdapter('OpenRouter');
    const { routes } = makeRoutes([row]);
    const { pools } = makePools(makePool('a'));

    const deployments = await createDeploymentResolver({
      routes,
      pools,
      createAdapter: () => adapter,
      headersFor: () => undefined,
    })('fast-model');

    expect(deployments[0]).not.toHaveProperty('headers');
  });

  it('returns an empty list without touching pools when there are no routes', async () => {
    const createAdapter = vi.fn<AdapterFactory>();
    const { routes } = makeRoutes([]);
    const { pools, get } = makePools(makePool('a'));

    const deployments = await createDeploymentResolver({
      routes,
      pools,
      createAdapter,
    })('missing-model');

    expect(deployments).toEqual([]);
    expect(createAdapter).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('propagates route repository errors', async () => {
    const listActiveByAlias = vi
      .fn<RouteProvider['listActiveByAlias']>()
      .mockRejectedValue(new Error('connection refused'));
    const { pools } = makePools(makePool('a'));

    const resolve = createDeploymentResolver({
      routes: { listActiveByAlias },
      pools,
      createAdapter: vi.fn<AdapterFactory>(),
    });

    await expect(resolve('fast-model')).rejects.toThrow('connection refused');
  });

  it('propagates key pool loading errors', async () => {
    const row = routeRow();
    const { routes } = makeRoutes([row]);
    const get = vi
      .fn<(providerId: string) => Promise<KeyPool>>()
      .mockRejectedValue(new Error('failed to decrypt secret'));

    const resolve = createDeploymentResolver({
      routes,
      pools: { get },
      createAdapter: () => new OpenAICompatibleAdapter('OpenRouter'),
    });

    await expect(resolve('fast-model')).rejects.toThrow(
      'failed to decrypt secret',
    );
  });
});
