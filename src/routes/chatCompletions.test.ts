import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.js';
import type {
  AuthenticatedClient,
  ClientAuthenticator,
} from '../auth/clientAuth.js';
import type { Env } from '../config/env.js';
import { GatewayError } from '../core/errors.js';
import type { RateLimitDecision, RateLimiter } from '../core/RateLimiter.js';
import type { RouterAttempt, RouterChatOptions } from '../core/Router.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ChatUsage,
  FinishReason,
} from '../core/types.js';
import {
  RequestLogRepository,
  type RequestLogRecord,
  type RequestLogWriter,
} from '../db/requestLogRepository.js';
import type { ChatCompletionHandler } from './chatCompletions.js';

const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://gateway:gateway@localhost:5432/llm_gateway',
  ADMIN_TOKEN: '0123456789abcdef',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
};

const testClient: AuthenticatedClient = {
  id: 'client-1',
  name: 'Test Client',
  rateLimitRpm: 60,
  monthlyBudgetMicros: 0,
};

const allowAllClients: ClientAuthenticator = async () => testClient;

const requireTestKey: ClientAuthenticator = async (authorization) => {
  if (authorization !== 'Bearer test-client-key') {
    throw new GatewayError({
      code: 'unauthorized',
      message: 'Invalid client API key',
    });
  }

  return testClient;
};

function rateLimitDecision(
  overrides: Partial<RateLimitDecision> = {},
): RateLimitDecision {
  return {
    allowed: true,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 0,
    resetAt: 1_800_000_000_000,
    ...overrides,
  };
}

const allowAllLimiter: RateLimiter = {
  check: (_key, limit) =>
    rateLimitDecision({ limit, remaining: limit - 1 }),
};

class FakeRouter implements ChatCompletionHandler {
  readonly calls: ChatRequest[] = [];

  constructor(
    private readonly outcome: ChatResponse | Error,
    private readonly attempts: RouterAttempt[] = [],
  ) {}

  async chat(
    request: ChatRequest,
    options?: RouterChatOptions,
  ): Promise<ChatResponse> {
    this.calls.push(request);

    for (const attempt of this.attempts) {
      options?.onAttempt?.(attempt);
    }

    if (this.outcome instanceof Error) {
      throw this.outcome;
    }

    return this.outcome;
  }
}

type StreamItem = ChatStreamChunk | Error;

class FakeStreamingRouter implements ChatCompletionHandler {
  readonly streamCalls: ChatRequest[] = [];

  constructor(
    private readonly items: StreamItem[],
    private readonly attempts: RouterAttempt[] = [],
  ) {}

  async chat(): Promise<ChatResponse> {
    throw new Error('chat is not used in streaming route tests');
  }

  async *chatStream(
    request: ChatRequest,
    options?: RouterChatOptions,
  ): AsyncIterable<ChatStreamChunk> {
    this.streamCalls.push(request);

    for (const attempt of this.attempts) {
      options?.onAttempt?.(attempt);
    }

    for (const item of this.items) {
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

interface ParsedSseEvent {
  event?: string;
  data: string;
}

function parseSse(payload: string): ParsedSseEvent[] {
  return payload
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event: string | undefined;
      const dataLines: string[] = [];

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      return {
        ...(event !== undefined ? { event } : {}),
        data: dataLines.join('\n'),
      };
    });
}

function chatResponse(): ChatResponse {
  return {
    id: 'chatcmpl-1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'OpenRouter',
    content: 'Привет!',
    finishReason: 'stop',
    usage: {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
    },
    latencyMs: 42,
    requestedModel: 'fast-model',
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

function createApp(
  router?: ChatCompletionHandler,
  authenticateClient: ClientAuthenticator = allowAllClients,
  rateLimiter: RateLimiter = allowAllLimiter,
  requestLogs?: RequestLogRepository,
): FastifyInstance {
  app = buildApp(testEnv, {
    authenticateClient,
    rateLimiter,
    ...(router === undefined ? {} : { router }),
    ...(requestLogs === undefined ? {} : { requestLogs }),
  });
  return app;
}

describe('POST /v1/chat/completions', () => {
  it('returns an OpenAI-compatible response and maps snake_case parameters', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        temperature: 0.2,
        max_tokens: 100,
        top_p: 0.9,
        stop: ['\n'],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body).toMatchObject({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'fast-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Привет!' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      },
      provider: 'OpenRouter',
      latency_ms: 42,
    });
    expect(body.created).toEqual(expect.any(Number));

    expect(router.calls).toHaveLength(1);
    expect(router.calls[0]).toMatchObject({
      model: 'fast-model',
      messages: [{ role: 'user', content: 'Привет!' }],
      temperature: 0.2,
      maxTokens: 100,
      topP: 0.9,
      stop: ['\n'],
    });
  });

  it.each([
    [
      'missing model',
      { messages: [{ role: 'user', content: 'Привет!' }] },
    ],
    ['empty messages', { model: 'fast-model', messages: [] }],
    [
      'invalid role',
      {
        model: 'fast-model',
        messages: [{ role: 'tool', content: 'Привет!' }],
      },
    ],
    [
      'temperature out of range',
      {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        temperature: 3,
      },
    ],
    [
      'top_p out of range',
      {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        top_p: 2,
      },
    ],
  ])('rejects an invalid request: %s', async (_name, payload) => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        type: 'invalid_request_error',
        code: 'invalid_request',
      },
    });
    expect(router.calls).toHaveLength(0);
  });

  it.each([
    ['no_route', 404, 'invalid_request_error'],
    ['rate_limited', 429, 'rate_limit_error'],
    ['unauthorized', 401, 'authentication_error'],
    ['forbidden', 403, 'permission_error'],
    ['all_providers_failed', 502, 'api_error'],
    ['provider_timeout', 504, 'api_error'],
  ] as const)(
    'maps GatewayError %s to HTTP %i',
    async (code, status, type) => {
      const router = new FakeRouter(
        new GatewayError({ code, message: `simulated ${code}` }),
      );
      const server = createApp(router);

      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'fast-model',
          messages: [{ role: 'user', content: 'Привет!' }],
        },
      });

      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({
        error: {
          message: `simulated ${code}`,
          type,
          code,
        },
      });
    },
  );

  it('includes the upstream status when the provider returned one', async () => {
    const router = new FakeRouter(
      new GatewayError({
        code: 'upstream_error',
        message: 'Provider returned 503',
        providerStatus: 503,
      }),
    );
    const server = createApp(router);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: {
        code: 'upstream_error',
        provider_status: 503,
      },
    });
  });

  it('wraps unknown router errors into internal_error', async () => {
    const router = new FakeRouter(new Error('unexpected failure'));
    const server = createApp(router);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        message: 'unexpected failure',
        type: 'api_error',
        code: 'internal_error',
      },
    });
  });

  it('returns a clear error when the router is not configured', async () => {
    const server = createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        message: 'Router is not configured',
        code: 'internal_error',
      },
    });
  });

  it('returns a clear error when authentication is not configured', async () => {
    const router = new FakeRouter(chatResponse());
    app = buildApp(testEnv, { router });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        message: 'Client authentication is not configured',
        code: 'internal_error',
      },
    });
  });
});

describe('client authentication on POST /v1/chat/completions', () => {
  it('rejects a request without a bearer token', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router, requireTestKey);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        type: 'authentication_error',
        code: 'unauthorized',
      },
    });
    expect(router.calls).toHaveLength(0);
  });

  it('rejects an unknown bearer token', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router, requireTestKey);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer wrong-key' },
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(401);
    expect(router.calls).toHaveLength(0);
  });

  it('authenticates before validating the request body', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router, requireTestKey);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { messages: [] },
    });

    expect(response.statusCode).toBe(401);
    expect(router.calls).toHaveLength(0);
  });

  it('accepts a valid bearer token', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router, requireTestKey);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-client-key' },
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(router.calls).toHaveLength(1);
  });
});

describe('rate limiting on POST /v1/chat/completions', () => {
  it('returns 429 with Retry-After when the client exceeds its limit', async () => {
    const router = new FakeRouter(chatResponse());
    const check = vi.fn<RateLimiter['check']>().mockReturnValue(
      rateLimitDecision({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 42,
      }),
    );
    const server = createApp(router, allowAllClients, { check });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
    expect(response.headers['x-ratelimit-limit']).toBe('60');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(response.json()).toMatchObject({
      error: {
        type: 'rate_limit_error',
        code: 'rate_limited',
      },
    });
    expect(router.calls).toHaveLength(0);
  });

  it('checks the limit using the client id and its configured rpm', async () => {
    const router = new FakeRouter(chatResponse());
    const check = vi
      .fn<RateLimiter['check']>()
      .mockReturnValue(rateLimitDecision());
    const server = createApp(router, allowAllClients, { check });

    await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(check).toHaveBeenCalledWith('client-1', 60);
  });

  it('exposes rate limit headers on successful responses', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe('60');
    expect(response.headers['x-ratelimit-remaining']).toBe('59');
    expect(response.headers['x-ratelimit-reset']).toBe('1800000000');
  });

  it('returns a clear error when the rate limiter is not configured', async () => {
    const router = new FakeRouter(chatResponse());
    app = buildApp(testEnv, { router, authenticateClient: allowAllClients });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        message: 'Rate limiter is not configured',
        code: 'internal_error',
      },
    });
  });
});

function successAttempt(
  overrides: Partial<RouterAttempt> = {},
): RouterAttempt {
  return {
    attemptNo: 1,
    providerId: 'provider-1',
    apiKeyId: 'key-1',
    upstreamModel: 'upstream-model',
    status: 'success',
    httpStatus: 200,
    latencyMs: 5,
    ...overrides,
  };
}

describe('request logging on POST /v1/chat/completions', () => {
  it('stores a successful request together with its attempts', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeRouter(chatResponse(), [successAttempt()]);
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    expect(writer).toHaveBeenCalledTimes(1);

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      clientId: 'client-1',
      requestedModel: 'fast-model',
      actualModel: 'upstream-model',
      providerId: 'provider-1',
      apiKeyId: 'key-1',
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      status: 'success',
      errorCode: null,
      isStream: false,
    });
    expect(record.requestId).toBe(response.headers['x-request-id']);
    expect(record.attempts).toEqual([
      {
        attemptNo: 1,
        providerId: 'provider-1',
        apiKeyId: 'key-1',
        status: 'success',
        httpStatus: 200,
        errorCode: null,
        latencyMs: 5,
      },
    ]);
  });

  it('stores a failed request with the upstream error', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeRouter(
      new GatewayError({
        code: 'upstream_error',
        message: 'provider exploded',
        providerStatus: 500,
      }),
      [
        successAttempt({
          status: 'error',
          httpStatus: 500,
          errorCode: 'upstream_error',
        }),
      ],
    );
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(502);

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      clientId: 'client-1',
      requestedModel: 'fast-model',
      actualModel: 'upstream-model',
      providerId: 'provider-1',
      apiKeyId: 'key-1',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'error',
      errorCode: 'upstream_error',
    });
    expect(record.attempts[0]).toMatchObject({
      status: 'error',
      httpStatus: 500,
      errorCode: 'upstream_error',
    });
  });

  it('marks a request as timeout when the last attempt timed out', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeRouter(
      new GatewayError({
        code: 'provider_timeout',
        message: 'provider timed out',
      }),
      [
        {
          attemptNo: 1,
          providerId: 'provider-1',
          apiKeyId: 'key-1',
          upstreamModel: 'upstream-model',
          status: 'timeout',
          errorCode: 'provider_timeout',
          latencyMs: 30_000,
        },
      ],
    );
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(504);

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      status: 'timeout',
      errorCode: 'provider_timeout',
    });
    expect(record.attempts[0]).toMatchObject({
      status: 'timeout',
      httpStatus: null,
      errorCode: 'provider_timeout',
    });
  });

  it('does not fail the response when the log cannot be stored', async () => {
    const writer = vi
      .fn<RequestLogWriter>()
      .mockRejectedValue(new Error('database is down'));
    const router = new FakeRouter(chatResponse(), [successAttempt()]);
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: 'chat.completion',
      model: 'fast-model',
    });
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('returns X-Request-Id even when the request is rejected', async () => {
    const server = createApp(new FakeRouter(chatResponse()));

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('streaming on POST /v1/chat/completions', () => {
  it('returns OpenAI-compatible SSE chunks and finishes with [DONE]', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeStreamingRouter(
      [
        delta('При'),
        delta('вет'),
        done('stop', {
          promptTokens: 3,
          completionTokens: 2,
          totalTokens: 5,
        }),
      ],
      [successAttempt()],
    );
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-ratelimit-limit']).toBe('60');

    const events = parseSse(response.payload);

    expect(events.at(-1)).toEqual({ data: '[DONE]' });

    const chunks = events
      .slice(0, -1)
      .map((event) => JSON.parse(event.data) as Record<string, unknown>);

    expect(chunks[0]).toMatchObject({
      id: `chatcmpl-${response.headers['x-request-id']}`,
      object: 'chat.completion.chunk',
      model: 'fast-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        },
      ],
    });
    expect(chunks[1]).toMatchObject({
      choices: [{ delta: { content: 'При' }, finish_reason: null }],
    });
    expect(chunks[2]).toMatchObject({
      choices: [{ delta: { content: 'вет' }, finish_reason: null }],
    });
    expect(chunks[3]).toMatchObject({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      },
    });

    expect(router.streamCalls).toHaveLength(1);
    expect(router.streamCalls[0]).toMatchObject({
      model: 'fast-model',
      stream: true,
    });

    expect(writer).toHaveBeenCalledTimes(1);

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      clientId: 'client-1',
      requestedModel: 'fast-model',
      actualModel: 'upstream-model',
      providerId: 'provider-1',
      apiKeyId: 'key-1',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      status: 'success',
      errorCode: null,
      isStream: true,
    });
    expect(record.ttftMs).toEqual(expect.any(Number));
    expect(record.latencyMs).toEqual(expect.any(Number));
  });

  it('returns a JSON error when the stream fails before the first chunk', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeStreamingRouter(
      [
        new GatewayError({
          code: 'upstream_error',
          message: 'provider exploded',
          providerStatus: 500,
        }),
      ],
      [
        successAttempt({
          status: 'error',
          httpStatus: 500,
          errorCode: 'upstream_error',
        }),
      ],
    );
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({
      error: {
        code: 'upstream_error',
        message: 'provider exploded',
        provider_status: 500,
      },
    });

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      status: 'error',
      errorCode: 'upstream_error',
      isStream: true,
      ttftMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('sends an SSE error event when the stream fails after the first chunk', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeStreamingRouter(
      [
        delta('partial'),
        new GatewayError({
          code: 'upstream_error',
          message: 'stream broke',
        }),
      ],
      [successAttempt()],
    );
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);

    const events = parseSse(response.payload);
    const errorEvent = events.find((event) => event.event === 'error');

    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data)).toMatchObject({
      error: {
        code: 'upstream_error',
        message: 'stream broke',
      },
    });
    expect(events.at(-1)).toEqual({ data: '[DONE]' });

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      status: 'error',
      errorCode: 'upstream_error',
      isStream: true,
    });
    expect(record.ttftMs).toEqual(expect.any(Number));
  });

  it('marks a client disconnect before the first chunk as cancelled', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const router = new FakeStreamingRouter([
      new GatewayError({
        code: 'client_disconnected',
        message: 'client went away',
      }),
    ]);
    const server = createApp(
      router,
      allowAllClients,
      allowAllLimiter,
      new RequestLogRepository(writer),
    );

    await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        stream: true,
      },
    });

    expect(writer).toHaveBeenCalledTimes(1);

    const record = writer.mock.calls[0]![0];

    expect(record).toMatchObject({
      status: 'cancelled',
      errorCode: 'client_disconnected',
      isStream: true,
    });
  });

  it('returns a clear error when the router does not support streaming', async () => {
    const router = new FakeRouter(chatResponse());
    const server = createApp(router);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'fast-model',
        messages: [{ role: 'user', content: 'Привет!' }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        code: 'internal_error',
        message: 'Streaming is not supported by the configured router',
      },
    });
  });
});
