import { describe, expect, it } from 'vitest';

import { GatewayError } from './errors.js';
import type { KeyStateEvent } from './keyState.js';
import { KeyPool } from './KeyPool.js';
import {
  Router,
  type RouterAttempt,
  type RouterDeployment,
  type RouterOptions,
} from './Router.js';
import type {
  ChatOptions,
  ChatRequest,
  ChatStreamChunk,
  ChatUsage,
  FinishReason,
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

type StreamItem = ChatStreamChunk | Error;
type StreamOutcome = StreamItem[] | Error;

class FakeStreamingAdapter implements LLMProviderAdapter {
  readonly type: ProviderType = 'mock';
  readonly streamCalls: Array<{
    request: ProviderChatRequest;
    options: ChatOptions;
  }> = [];

  private readonly outcomes: StreamOutcome[];

  constructor(
    readonly name: string,
    ...outcomes: StreamOutcome[]
  ) {
    this.outcomes = outcomes;
  }

  async chat(): Promise<ProviderChatResponse> {
    throw new Error('chat is not used in streaming Router tests');
  }

  async *chatStream(
    request: ProviderChatRequest,
    options: ChatOptions,
  ): AsyncIterable<ChatStreamChunk> {
    this.streamCalls.push({ request, options });

    const outcome = this.outcomes.shift();

    if (outcome === undefined) {
      throw new Error(`No stream outcome configured for ${this.name}`);
    }

    if (outcome instanceof Error) {
      throw outcome;
    }

    for (const item of outcome) {
      if (item instanceof Error) {
        throw item;
      }

      yield item;
    }
  }
}

function delta(content: string): ChatStreamChunk {
  return { type: 'delta', content };
}

function done(
  finishReason: FinishReason = 'stop',
  usage?: ChatUsage,
): ChatStreamChunk {
  return {
    type: 'done',
    finishReason,
    ...(usage !== undefined ? { usage } : {}),
  };
}

async function collectChunks(
  stream: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const chunks: ChatStreamChunk[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
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
  inputPriceMicrosPer1m?: number;
  outputPriceMicrosPer1m?: number;
}): RouterDeployment {
  return {
    providerId: params.providerId ?? 'provider-1',
    upstreamModel: params.upstreamModel ?? 'upstream-model',
    priority: params.priority ?? 1,
    adapter: params.adapter,
    keyPool: params.keyPool,
    baseUrl: params.baseUrl ?? 'https://example.test/v1',
    timeoutMs: params.timeoutMs ?? 1_000,
    inputPriceMicrosPer1m: params.inputPriceMicrosPer1m ?? 0,
    outputPriceMicrosPer1m: params.outputPriceMicrosPer1m ?? 0,
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

  it('calculates cost from the selected deployment prices', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const router = makeRouter([
      makeDeployment({
        adapter,
        keyPool: makePool('a'),
        inputPriceMicrosPer1m: 1_000_000,
        outputPriceMicrosPer1m: 1_000_000,
      }),
    ]);

    const result = await router.chat(request);

    // response() uses 1 prompt + 1 completion token.
    expect(result.costMicros).toBe(2);
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

describe('Router attempt observer', () => {
  it('reports a successful attempt with provider, key and upstream model', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const router = makeRouter([
      makeDeployment({
        adapter,
        keyPool: makePool('a'),
        providerId: 'provider-1',
        upstreamModel: 'upstream-model',
      }),
    ]);
    const attempts: RouterAttempt[] = [];

    await router.chat(request, {
      onAttempt: (attempt) => attempts.push(attempt),
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptNo: 1,
      providerId: 'provider-1',
      apiKeyId: 'a',
      upstreamModel: 'upstream-model',
      status: 'success',
      httpStatus: 200,
    });
    expect(attempts[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports failed and successful attempts in order during fallback', async () => {
    const adapter = new FakeAdapter(
      'Mock',
      gatewayError('rate_limited'),
      response('Mock', 'second-key'),
    );
    const router = makeRouter([
      makeDeployment({ adapter, keyPool: makePool('a', 'b') }),
    ]);
    const attempts: RouterAttempt[] = [];

    await router.chat(request, {
      onAttempt: (attempt) => attempts.push(attempt),
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attemptNo: 1,
      apiKeyId: 'a',
      status: 'error',
      errorCode: 'rate_limited',
    });
    expect(attempts[0]?.httpStatus).toBeUndefined();
    expect(attempts[1]).toMatchObject({
      attemptNo: 2,
      apiKeyId: 'b',
      status: 'success',
    });
  });

  it('marks provider timeouts as timeout attempts', async () => {
    const first = new FakeAdapter('First', gatewayError('provider_timeout'));
    const second = new FakeAdapter('Second', response('Second'));
    const router = makeRouter([
      makeDeployment({ adapter: first, keyPool: makePool('a') }),
      makeDeployment({ adapter: second, keyPool: makePool('b') }),
    ]);
    const attempts: RouterAttempt[] = [];

    await router.chat(request, {
      onAttempt: (attempt) => attempts.push(attempt),
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      status: 'timeout',
      errorCode: 'provider_timeout',
    });
    expect(attempts[1]?.status).toBe('success');
  });

  it('does not fail the request when the observer throws', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const router = makeRouter([
      makeDeployment({ adapter, keyPool: makePool('a') }),
    ]);

    await expect(
      router.chat(request, {
        onAttempt: () => {
          throw new Error('observer failed');
        },
      }),
    ).resolves.toMatchObject({ content: 'ok' });
  });
});

describe('Router key state observer', () => {
  it('reports a rate limit and the following success', async () => {
    const adapter = new FakeAdapter(
      'Mock',
      gatewayError('rate_limited'),
      response('Mock', 'second-key'),
    );
    const events: KeyStateEvent[] = [];
    const router = makeRouter(
      [makeDeployment({ adapter, keyPool: makePool('a', 'b') })],
      { onKeyState: (event) => events.push(event) },
    );

    await router.chat(request);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      keyId: 'a',
      type: 'rate_limited',
    });
    expect(events[0]!.at).toEqual(expect.any(Number));
    expect(events[0]!.cooldownUntil).toBeGreaterThan(events[0]!.at);
    expect(events[1]).toMatchObject({
      keyId: 'b',
      type: 'success',
    });
  });

  it('reports an invalid key after 401/403', async () => {
    const adapter = new FakeAdapter(
      'Mock',
      gatewayError('unauthorized'),
      response('Mock', 'second-key'),
    );
    const events: KeyStateEvent[] = [];
    const router = makeRouter(
      [makeDeployment({ adapter, keyPool: makePool('a', 'b') })],
      { onKeyState: (event) => events.push(event) },
    );

    await router.chat(request);

    expect(events[0]).toMatchObject({
      keyId: 'a',
      type: 'invalid',
    });
    expect(events[0]!.cooldownUntil).toBeUndefined();
  });

  it('reports a generic key failure without cooldown', async () => {
    const adapter = new FakeAdapter('Mock', gatewayError('upstream_error'));
    const events: KeyStateEvent[] = [];
    const router = makeRouter(
      [makeDeployment({ adapter, keyPool: makePool('a') })],
      { onKeyState: (event) => events.push(event) },
    );

    await expect(router.chat(request)).rejects.toMatchObject({
      code: 'all_providers_failed',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      keyId: 'a',
      type: 'failure',
    });
    expect(events[0]!.cooldownUntil).toBeUndefined();
  });

  it('does not fail the request when the key state observer throws', async () => {
    const adapter = new FakeAdapter('Mock', response());
    const router = makeRouter(
      [makeDeployment({ adapter, keyPool: makePool('a') })],
      {
        onKeyState: () => {
          throw new Error('key state observer failed');
        },
      },
    );

    await expect(router.chat(request)).resolves.toMatchObject({
      content: 'ok',
    });
  });
});

describe('Router streaming', () => {
  it('yields chunks and reports a successful attempt', async () => {
    const adapter = new FakeStreamingAdapter('Mock', [
      delta('При'),
      delta('вет'),
      done('stop', {
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
      }),
    ]);
    const keyPool = makePool('a');
    const attempts: RouterAttempt[] = [];
    const events: KeyStateEvent[] = [];
    const router = makeRouter(
      [makeDeployment({ adapter, keyPool })],
      { onKeyState: (event) => events.push(event) },
    );

    const chunks = await collectChunks(
      router.chatStream(
        { ...request, stream: true },
        { onAttempt: (attempt) => attempts.push(attempt) },
      ),
    );

    expect(chunks).toEqual([
      delta('При'),
      delta('вет'),
      {
        type: 'done',
        finishReason: 'stop',
        usage: {
          promptTokens: 3,
          completionTokens: 2,
          totalTokens: 5,
        },
        costMicros: 0,
      },
    ]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptNo: 1,
      providerId: 'provider-1',
      apiKeyId: 'a',
      upstreamModel: 'upstream-model',
      status: 'success',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      keyId: 'a',
      type: 'success',
    });
    expect(keyPool.snapshot().keys[0]?.usageCount).toBe(1);
  });

  it('adds the calculated cost to the final streaming chunk', async () => {
    const adapter = new FakeStreamingAdapter('Mock', [
      delta('ok'),
      done('stop', {
        promptTokens: 2_000_000,
        completionTokens: 1_000_000,
        totalTokens: 3_000_000,
      }),
    ]);
    const router = makeRouter([
      makeDeployment({
        adapter,
        keyPool: makePool('a'),
        inputPriceMicrosPer1m: 250,
        outputPriceMicrosPer1m: 500,
      }),
    ]);

    const chunks = await collectChunks(
      router.chatStream({ ...request, stream: true }),
    );

    expect(chunks.at(-1)).toEqual({
      type: 'done',
      finishReason: 'stop',
      usage: {
        promptTokens: 2_000_000,
        completionTokens: 1_000_000,
        totalTokens: 3_000_000,
      },
      costMicros: 1_000,
    });
  });

  it('falls back to the next key before the first chunk', async () => {
    const first = new FakeStreamingAdapter(
      'First',
      gatewayError('rate_limited'),
    );
    const second = new FakeStreamingAdapter('Second', [
      delta('ok'),
      done('stop'),
    ]);
    const firstPool = makePool('a');
    const secondPool = makePool('b');
    const attempts: RouterAttempt[] = [];
    const router = makeRouter([
      makeDeployment({
        adapter: first,
        keyPool: firstPool,
        providerId: 'provider-1',
      }),
      makeDeployment({
        adapter: second,
        keyPool: secondPool,
        providerId: 'provider-2',
      }),
    ]);

    const chunks = await collectChunks(
      router.chatStream(
        { ...request, stream: true },
        { onAttempt: (attempt) => attempts.push(attempt) },
      ),
    );

    expect(chunks).toEqual([
      delta('ok'),
      { type: 'done', finishReason: 'stop', costMicros: 0 },
    ]);
    expect(first.streamCalls).toHaveLength(1);
    expect(second.streamCalls).toHaveLength(1);
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      'error',
      'success',
    ]);
    expect(attempts[0]).toMatchObject({
      apiKeyId: 'a',
      errorCode: 'rate_limited',
    });
    expect(attempts[1]).toMatchObject({
      apiKeyId: 'b',
      status: 'success',
    });
    expect(firstPool.snapshot().keys[0]?.state).toBe('cooldown');
  });

  it('does not fall back after the first chunk', async () => {
    const first = new FakeStreamingAdapter('First', [
      delta('partial'),
      gatewayError('upstream_error'),
    ]);
    const second = new FakeStreamingAdapter('Second', [
      delta('never'),
      done('stop'),
    ]);
    const router = makeRouter([
      makeDeployment({
        adapter: first,
        keyPool: makePool('a'),
        providerId: 'provider-1',
      }),
      makeDeployment({
        adapter: second,
        keyPool: makePool('b'),
        providerId: 'provider-2',
      }),
    ]);
    const received: ChatStreamChunk[] = [];

    await expect(
      (async () => {
        for await (const chunk of router.chatStream({
          ...request,
          stream: true,
        })) {
          received.push(chunk);
        }
      })(),
    ).rejects.toMatchObject({
      code: 'upstream_error',
    });

    expect(received).toEqual([delta('partial')]);
    expect(second.streamCalls).toHaveLength(0);
  });

  it('rejects when no route is configured', async () => {
    const router = new Router(() => []);

    await expect(
      collectChunks(router.chatStream({ ...request, stream: true })),
    ).rejects.toMatchObject({
      code: 'no_route',
    });
  });

  it('rejects when no key is available', async () => {
    const adapter = new FakeStreamingAdapter('Mock', [
      delta('never'),
      done('stop'),
    ]);
    const router = makeRouter([
      makeDeployment({ adapter, keyPool: makePool() }),
    ]);

    await expect(
      collectChunks(router.chatStream({ ...request, stream: true })),
    ).rejects.toMatchObject({
      code: 'all_providers_failed',
      message: expect.stringContaining('No API keys available'),
    });
    expect(adapter.streamCalls).toHaveLength(0);
  });
});
