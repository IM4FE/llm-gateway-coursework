import { describe, expect, it, vi } from 'vitest';

import type {
  ChatOptions,
  ChatStreamChunk,
  ProviderChatRequest,
} from '../core/types.js';
import {
  OpenAICompatibleAdapter,
  type FetchLike,
} from './OpenAICompatibleAdapter.js';

const request: ProviderChatRequest = {
  upstreamModel: 'meta-llama/llama-3.3-70b-instruct:free',
  messages: [{ role: 'user', content: 'Привет!' }],
};

const options: ChatOptions = {
  apiKey: 'test-key',
  baseUrl: 'https://openrouter.ai/api/v1/',
  timeoutMs: 5_000,
  headers: {
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'LLM Gateway Coursework',
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successfulResponse(): Response {
  return jsonResponse({
    id: 'chatcmpl-1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    choices: [
      {
        message: { content: 'Привет!' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
    },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collectStream(
  stream: AsyncIterable<ChatStreamChunk>,
): Promise<ChatStreamChunk[]> {
  const chunks: ChatStreamChunk[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

describe('OpenAICompatibleAdapter', () => {
  it('sends an OpenAI-compatible request and normalizes the response', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(successfulResponse());

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);
    const response = await adapter.chat(request, options);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'LLM Gateway Coursework',
    });

    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'user', content: 'Привет!' }],
      stream: false,
    });

    expect(response).toMatchObject({
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
    });
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('passes optional completion parameters when they are present', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(successfulResponse());

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);
    await adapter.chat(
      {
        ...request,
        temperature: 0.2,
        maxTokens: 100,
        topP: 0.9,
        stop: ['\n'],
      },
      options,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));

    expect(body).toMatchObject({
      temperature: 0.2,
      max_tokens: 100,
      top_p: 0.9,
      stop: ['\n'],
    });
  });

  it('does not send optional parameters when they are absent', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(successfulResponse());

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);
    await adapter.chat(request, options);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));

    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('stop');
  });

  it('does not send Authorization when the api key is empty', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(successfulResponse());

    const adapter = new OpenAICompatibleAdapter('Ollama', fetchMock, 'ollama');
    await adapter.chat(request, {
      ...options,
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
    });

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it.each([
    [400, 'invalid_request', false],
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [408, 'provider_timeout', true],
    [429, 'rate_limited', true],
    [500, 'upstream_error', true],
    [503, 'upstream_error', true],
  ])(
    'maps HTTP %i to %s',
    async (status, code, retryable) => {
      const fetchMock = vi.fn<FetchLike>();
      fetchMock.mockResolvedValue(jsonResponse({ error: 'provider error' }, status));

      const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

      await expect(adapter.chat(request, options)).rejects.toMatchObject({
        name: 'GatewayError',
        code,
        retryable,
        providerStatus: status,
      });
    },
  );

  it('maps network failures to provider_unavailable', async () => {
    const cause = new Error('ECONNREFUSED');
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockRejectedValue(cause);

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    const error = await adapter.chat(request, options).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'GatewayError',
      code: 'provider_unavailable',
      retryable: true,
    });
    expect((error as Error).cause).toBe(cause);
  });

  it('maps timeouts to provider_timeout', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';

    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockRejectedValue(timeoutError);

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(adapter.chat(request, options)).rejects.toMatchObject({
      code: 'provider_timeout',
      retryable: true,
    });
  });

  it('maps an already aborted client signal to client_disconnected', async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockRejectedValue(new Error('aborted'));

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(
      adapter.chat(request, { ...options, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'client_disconnected',
      retryable: false,
    });
  });

  it('rejects invalid JSON from the provider', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(adapter.chat(request, options)).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Provider returned invalid JSON',
      retryable: true,
    });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'chatcmpl-1',
        model: 'test-model',
        choices: [],
      }),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(adapter.chat(request, options)).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Provider returned an unexpected response shape',
      retryable: true,
    });
  });

  it('rejects a response without message content', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'chatcmpl-1',
        model: 'test-model',
        choices: [
          {
            message: { content: null },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(adapter.chat(request, options)).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Provider returned no message content',
      retryable: true,
    });
  });

  it('maps finish reasons to the unified domain values', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'chatcmpl-1',
        model: 'test-model',
        choices: [
          {
            message: { content: 'ok' },
            finish_reason: 'length',
          },
        ],
      }),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);
    const response = await adapter.chat(request, options);

    expect(response.finishReason).toBe('length');
  });

  it('computes total tokens when the provider omits total_tokens', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'chatcmpl-1',
        model: 'test-model',
        choices: [
          {
            message: { content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 3,
        },
      }),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);
    const response = await adapter.chat(request, options);

    expect(response.usage.totalTokens).toBe(10);
  });
});

describe('OpenAICompatibleAdapter streaming', () => {
  it('parses deltas, finish reason and usage from SSE', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"При"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"вет"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);
    const chunks = await collectStream(adapter.chatStream(request, options));

    expect(chunks).toEqual([
      { type: 'delta', content: 'При' },
      { type: 'delta', content: 'вет' },
      {
        type: 'done',
        finishReason: 'stop',
        usage: {
          promptTokens: 3,
          completionTokens: 2,
          totalTokens: 5,
        },
      },
    ]);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));

    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
      Accept: 'text/event-stream',
    });
  });

  it('handles SSE events split across network chunks and CRLF', async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\n' +
      'data: [DONE]\r\n\r\n';
    const parts = payload.match(/[\s\S]{1,7}/g) ?? [];
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(sseResponse(parts));

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(
      collectStream(adapter.chatStream(request, options)),
    ).resolves.toEqual([
      { type: 'delta', content: 'ok' },
      { type: 'done', finishReason: 'unknown' },
    ]);
  });

  it('ignores SSE comments and empty data lines', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(
      sseResponse([
        ': ping\n\n',
        'data:\n\n',
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(
      collectStream(adapter.chatStream(request, options)),
    ).resolves.toEqual([
      { type: 'delta', content: 'a' },
      { type: 'done', finishReason: 'unknown' },
    ]);
  });

  it('maps an HTTP error before the stream starts', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'limited' }, 429));

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(
      collectStream(adapter.chatStream(request, options)),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      providerStatus: 429,
    });
  });

  it('rejects invalid JSON inside an SSE event', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(sseResponse(['data: not-json\n\n']));

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(
      collectStream(adapter.chatStream(request, options)),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Provider returned invalid stream data',
    });
  });

  it('rejects a response without a body', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const adapter = new OpenAICompatibleAdapter('OpenRouter', fetchMock);

    await expect(
      collectStream(adapter.chatStream(request, options)),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Provider returned an empty stream',
    });
  });
});
