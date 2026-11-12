import { describe, expect, it } from 'vitest';

import { GatewayError } from './errors.js';
import { KeyPool } from './KeyPool.js';
import {
  Router,
  type RouterDeployment,
  type RouterOptions,
} from './Router.js';
import type {
  ChatOptions,
  ChatRequest,
  ChatStreamChunk,
  LLMProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse,
  ProviderType,
} from './types.js';

const request: ChatRequest = {
  model: 'fast-model',
  messages: [{ role: 'user', content: 'Привет!' }],
};

type Outcome = ProviderChatResponse | Error;

class FakeAdapter implements LLMProviderAdapter {
  readonly type: ProviderType = 'mock';
  readonly calls: Array<{
    request: ProviderChatRequest;
    options: ChatOptions;
  }> = [];

  private readonly outcomes: Outcome[];

  constructor(
    readonly name: string,
    ...outcomes: Outcome[]
  ) {
    this.outcomes = outcomes;
  }

  async chat(
    request: ProviderChatRequest,
    options: ChatOptions,
  ): Promise<ProviderChatResponse> {
    this.calls.push({ request, options });

    const outcome = this.outcomes.shift();

    if (outcome === undefined) {
      throw new Error(`No outcome configured for ${this.name}`);
    }

    if (outcome instanceof Error) {
      throw outcome;
    }

    return outcome;
  }

  async *chatStream(): AsyncIterable<ChatStreamChunk> {
    throw new Error('chatStream is not used in Router tests');
  }
}

function response(
  provider: string = 'Mock',
  content: string = 'ok',
): ProviderChatResponse {
  return {
    id: 'response-1',
    model: 'upstream-model',
    provider,
    content,
    finishReason: 'stop',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    },
    latencyMs: 5,
  };
}

function gatewayError(code: GatewayError['code']): GatewayError {
  return new GatewayError({ code, message: `simulated ${code}` });
}

function makePool(...ids: string[]): KeyPool {
  return new KeyPool(
    ids.map((id) => ({
      id,
      value: `secret-${id}`,
      hint: `...${id}`,
    })),
  );
}

function makeDeployment(params: {
  adapter: LLMProviderAdapter;
  keyPool: KeyPool;
  priority?: number;
  providerId?: string;
  upstreamModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}): RouterDeployment {
  return {
    providerId: params.providerId ?? 'provider-1',
    upstreamModel: params.upstreamModel ?? 'upstream-model',
    priority: params.priority ?? 1,
    adapter: params.adapter,
    keyPool: params.keyPool,
    baseUrl: params.baseUrl ?? 'https://example.test/v1',
    timeoutMs: params.timeoutMs ?? 1_000,
    ...(params.headers !== undefined ? { headers: params.headers } : {}),
  };
}

function makeRouter(
  deployments: RouterDeployment[],
  options: RouterOptions = {},
): Router {
  return new Router(() => deployments, options);
}

describe('Router', () => {
  it('returns a normalized response with the requested alias', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const keyPool = makePool('a');
    keyPool.reportFailure('a');

    const router = makeRouter([makeDeployment({ adapter, keyPool })]);
    const result = await router.chat(request);

    expect(result).toMatchObject({
      requestedModel: 'fast-model',
      provider: 'Mock',
      content: 'ok',
    });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]!.request.upstreamModel).toBe('upstream-model');
    expect(adapter.calls[0]!.options.apiKey).toBe('secret-a');
    expect(keyPool.snapshot().keys[0]).toMatchObject({
      state: 'active',
      failureCount: 0,
    });
  });

  it('passes completion parameters, headers and the abort signal to the adapter', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const controller = new AbortController();

    const router = makeRouter([
      makeDeployment({
        adapter,
        keyPool: makePool('a'),
        baseUrl: 'https://provider.test/v1',
        timeoutMs: 2_500,
        headers: { 'X-Title': 'Gateway' },
      }),
    ]);

    await router.chat(
      {
        ...request,
        temperature: 0.2,
        maxTokens: 100,
        topP: 0.9,
        stop: ['\n'],
      },
      { signal: controller.signal },
    );

    const call = adapter.calls[0]!;

    expect(call.request).toMatchObject({
      messages: request.messages,
      upstreamModel: 'upstream-model',
      temperature: 0.2,
      maxTokens: 100,
      topP: 0.9,
      stop: ['\n'],
    });
    expect(call.options).toMatchObject({
      apiKey: 'secret-a',
      baseUrl: 'https://provider.test/v1',
      timeoutMs: 2_500,
      headers: { 'X-Title': 'Gateway' },
      signal: controller.signal,
    });
  });

  it('rejects when no route is configured for the alias', async () => {
    const router = new Router(() => []);

    await expect(router.chat(request)).rejects.toMatchObject({
      code: 'no_route',
    });
  });

  it('wraps resolver failures into internal_error', async () => {
    const router = new Router(() => {
      throw new Error('database is down');
    });

    await expect(router.chat(request)).rejects.toMatchObject({
      code: 'internal_error',
      message: 'database is down',
    });
  });

  it('rejects streaming requests before resolving routes', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const router = makeRouter([
      makeDeployment({ adapter, keyPool: makePool('a') }),
    ]);

    await expect(
      router.chat({ ...request, stream: true }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'Streaming is not implemented yet',
    });
    expect(adapter.calls).toHaveLength(0);
  });

  it('tries the next key after a 429 and puts the first key into cooldown', async () => {
    const adapter = new FakeAdapter(
      'Mock',
      gatewayError('rate_limited'),
      response('Mock', 'second-key'),
    );
    const keyPool = makePool('a', 'b');

    const router = makeRouter([makeDeployment({ adapter, keyPool })]);
    const result = await router.chat(request);

    expect(result.content).toBe('second-key');
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]!.options.apiKey).toBe('secret-a');
    expect(adapter.calls[1]!.options.apiKey).toBe('secret-b');

    const snapshot = keyPool.snapshot();
    expect(snapshot.keys[0]).toMatchObject({ id: 'a', state: 'cooldown' });
    expect(snapshot.keys[0]?.cooldownUntil).not.toBeNull();
    expect(snapshot.keys[1]).toMatchObject({
      id: 'b',
      state: 'active',
      usageCount: 1,
    });
  });

  it.each(['unauthorized', 'forbidden'] as const)(
    'tries the next key after %s and marks the first key invalid',
    async (code) => {
      const adapter = new FakeAdapter(
        'Mock',
        gatewayError(code),
        response('Mock', 'second-key'),
      );
      const keyPool = makePool('a', 'b');

      const router = makeRouter([makeDeployment({ adapter, keyPool })]);
      const result = await router.chat(request);

      expect(result.content).toBe('second-key');
      expect(keyPool.snapshot().keys[0]).toMatchObject({
        id: 'a',
        state: 'invalid',
      });
      expect(keyPool.snapshot().keys[1]?.state).toBe('active');
    },
  );

  it.each([
    'provider_timeout',
    'provider_unavailable',
    'upstream_error',
  ] as const)(
    'falls back to the next deployment after %s',
    async (code) => {
      const first = new FakeAdapter('First', gatewayError(code));
      const second = new FakeAdapter('Second', response('Second'));
      const firstPool = makePool('a');
      const secondPool = makePool('b');

      const router = makeRouter([
        makeDeployment({
          adapter: first,
          keyPool: firstPool,
          providerId: 'provider-1',
          priority: 1,
        }),
        makeDeployment({
          adapter: second,
          keyPool: secondPool,
          providerId: 'provider-2',
          priority: 2,
        }),
      ]);

      const result = await router.chat(request);

      expect(result.provider).toBe('Second');
      expect(first.calls).toHaveLength(1);
      expect(second.calls).toHaveLength(1);
      expect(firstPool.snapshot().keys[0]).toMatchObject({
        state: 'active',
        failureCount: 1,
      });
      expect(secondPool.snapshot().keys[0]).toMatchObject({
        state: 'active',
        failureCount: 0,
      });
    },
  );

  it('sorts deployments by priority before calling adapters', async () => {
    const highPriority = new FakeAdapter('High', response('High'));
    const lowPriority = new FakeAdapter('Low', response('Low'));

    const router = makeRouter([
      makeDeployment({
        adapter: lowPriority,
        keyPool: makePool('low'),
        priority: 2,
      }),
      makeDeployment({
        adapter: highPriority,
        keyPool: makePool('high'),
        priority: 1,
      }),
    ]);

    const result = await router.chat(request);

    expect(result.provider).toBe('High');
    expect(highPriority.calls).toHaveLength(1);
    expect(lowPriority.calls).toHaveLength(0);
  });

  it.each([
    'invalid_request',
    'client_disconnected',
    'internal_error',
  ] as const)(
    'stops immediately on terminal error %s',
    async (code) => {
      const first = new FakeAdapter('First', gatewayError(code));
      const second = new FakeAdapter('Second', response('Second'));

      const router = makeRouter([
        makeDeployment({ adapter: first, keyPool: makePool('a') }),
        makeDeployment({ adapter: second, keyPool: makePool('b') }),
      ]);

      await expect(router.chat(request)).rejects.toMatchObject({ code });
      expect(first.calls).toHaveLength(1);
      expect(second.calls).toHaveLength(0);
    },
  );

  it('wraps unknown adapter errors into a terminal internal_error', async () => {
    const first = new FakeAdapter('First', new Error('boom'));
    const second = new FakeAdapter('Second', response('Second'));

    const router = makeRouter([
      makeDeployment({ adapter: first, keyPool: makePool('a') }),
      makeDeployment({ adapter: second, keyPool: makePool('b') }),
    ]);

    await expect(router.chat(request)).rejects.toMatchObject({
      code: 'internal_error',
      message: 'boom',
    });
    expect(second.calls).toHaveLength(0);
  });

  it('respects the global maxAttempts limit', async () => {
    const adapter = new FakeAdapter(
      'Mock',
      gatewayError('rate_limited'),
      gatewayError('rate_limited'),
      response(),
    );
    const keyPool = makePool('a', 'b', 'c');

    const router = makeRouter([makeDeployment({ adapter, keyPool })], {
      maxAttempts: 2,
    });

    await expect(router.chat(request)).rejects.toMatchObject({
      code: 'all_providers_failed',
      details: {
        attempts: 2,
        lastErrorCode: 'rate_limited',
      },
    });
    expect(adapter.calls).toHaveLength(2);
    expect(keyPool.snapshot().keys[2]?.state).toBe('active');
  });

  it('falls back to the next deployment after exhausting all keys of the first one', async () => {
    const first = new FakeAdapter(
      'First',
      gatewayError('rate_limited'),
      gatewayError('rate_limited'),
    );
    const second = new FakeAdapter('Second', response('Second'));
    const firstPool = makePool('a', 'b');
    const secondPool = makePool('c');

    const router = makeRouter([
      makeDeployment({ adapter: first, keyPool: firstPool }),
      makeDeployment({ adapter: second, keyPool: secondPool }),
    ]);

    const result = await router.chat(request);

    expect(result.provider).toBe('Second');
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(1);
    expect(firstPool.snapshot().available).toBe(0);
  });

  it('reports all_providers_failed when no deployment has an available key', async () => {
    const adapter = new FakeAdapter('Mock', response());

    const router = makeRouter([
      makeDeployment({ adapter, keyPool: makePool() }),
    ]);

    await expect(router.chat(request)).rejects.toMatchObject({
      code: 'all_providers_failed',
      message: expect.stringContaining('No API keys available'),
    });
    expect(adapter.calls).toHaveLength(0);
  });

  it('keeps the last error as the cause of all_providers_failed', async () => {
    const adapter = new FakeAdapter(
      'Mock',
      gatewayError('upstream_error'),
    );
    const router = makeRouter([
      makeDeployment({ adapter, keyPool: makePool('a') }),
    ]);

    const error = await router.chat(request).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'GatewayError',
      code: 'all_providers_failed',
    });
    expect((error as GatewayError).cause).toMatchObject({
      name: 'GatewayError',
      code: 'upstream_error',
    });
  });

  it('validates router options', () => {
    expect(
      () => new Router(() => [], { maxAttempts: 0 }),
    ).toThrow('maxAttempts must be a positive integer');
    expect(
      () => new Router(() => [], { maxAttempts: 1.5 }),
    ).toThrow('maxAttempts must be a positive integer');
    expect(
      () => new Router(() => [], { cooldownMs: -1 }),
    ).toThrow('cooldownMs must be non-negative');
  });
});
