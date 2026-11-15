import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import type {
  AuthenticatedClient,
  ClientAuthenticator,
} from '../auth/clientAuth.js';
import type { Env } from '../config/env.js';
import { GatewayError } from '../core/errors.js';
import type { RouterChatOptions } from '../core/Router.js';
import type { ChatRequest, ChatResponse } from '../core/types.js';
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

class FakeRouter implements ChatCompletionHandler {
  readonly calls: ChatRequest[] = [];

  constructor(private readonly outcome: ChatResponse | Error) {}

  async chat(
    request: ChatRequest,
    _options?: RouterChatOptions,
  ): Promise<ChatResponse> {
    this.calls.push(request);

    if (this.outcome instanceof Error) {
      throw this.outcome;
    }

    return this.outcome;
  }
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
): FastifyInstance {
  app = buildApp(testEnv, {
    authenticateClient,
    ...(router === undefined ? {} : { router }),
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
