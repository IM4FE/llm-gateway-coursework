import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { GatewayError } from '../core/errors.js';
import type {
  ChatOptions,
  ChatStreamChunk,
  FinishReason,
  LLMProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse,
  ProviderType,
} from '../core/types.js';

/**
 * Минимальная сигнатура fetch, которую использует адаптер.
 * Благодаря этому в тестах можно подставить фейковый fetch
 * и не ходить в реальную сеть.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const openAIResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

/**
 * Адаптер для провайдеров с OpenAI-совместимым API:
 * OpenRouter, OpenAI, Groq, Ollama (OpenAI-compatible endpoint).
 *
 * Адаптер не знает про пул ключей и fallback. Он получает готовые
 * baseUrl и apiKey, делает HTTP-запрос и нормализует ответ.
 */
export class OpenAICompatibleAdapter implements LLMProviderAdapter {
  readonly type: ProviderType;

  constructor(
    readonly name: string,
    private readonly fetchImpl: FetchLike = fetch,
    type: ProviderType = 'openai_compatible',
  ) {
    this.type = type;
  }

  async chat(
    request: ProviderChatRequest,
    options: ChatOptions,
  ): Promise<ProviderChatResponse> {
    const startedAt = performance.now();
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const body: Record<string, unknown> = {
      model: request.upstreamModel,
      messages: request.messages,
      stream: false,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }
    if (request.stop !== undefined) {
      body.stop = request.stop;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      ...options.headers,
    };

    let response: Response;

    try {
      response = await this.fetchImpl(
        `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error) {
      throw mapTransportError(error, options, timeoutSignal);
    }

    if (!response.ok) {
      const details = await readBodySafely(response);
      throw mapHttpError(response.status, details);
    }

    const payload = await readJson(response);
    const parsed = openAIResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new GatewayError({
        code: 'upstream_error',
        message: 'Provider returned an unexpected response shape',
        providerStatus: response.status,
        details: parsed.error.issues,
        retryable: true,
      });
    }

    const choice = parsed.data.choices[0];

    if (!choice || choice.message.content === null) {
      throw new GatewayError({
        code: 'upstream_error',
        message: 'Provider returned no message content',
        providerStatus: response.status,
        retryable: true,
      });
    }

    const promptTokens = parsed.data.usage?.prompt_tokens ?? 0;
    const completionTokens = parsed.data.usage?.completion_tokens ?? 0;
    const totalTokens =
      parsed.data.usage?.total_tokens ?? promptTokens + completionTokens;

    return {
      id: parsed.data.id,
      model: parsed.data.model,
      provider: this.name,
      content: choice.message.content,
      finishReason: mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }

  async *chatStream(
    _request: ProviderChatRequest,
    _options: ChatOptions,
  ): AsyncIterable<ChatStreamChunk> {
    throw new GatewayError({
      code: 'internal_error',
      message: 'Streaming is not implemented yet',
    });
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new GatewayError({
      code: 'upstream_error',
      message: 'Provider returned invalid JSON',
      providerStatus: response.status,
      retryable: true,
      cause: error,
    });
  }
}

async function readBodySafely(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text;
  } catch {
    return undefined;
  }
}

function mapHttpError(status: number, details: string | undefined): GatewayError {
  if (status === 401) {
    return new GatewayError({
      code: 'unauthorized',
      message: 'Provider rejected the API key',
      providerStatus: status,
      details,
    });
  }

  if (status === 403) {
    return new GatewayError({
      code: 'forbidden',
      message: 'Provider forbade the request',
      providerStatus: status,
      details,
    });
  }

  if (status === 408) {
    return new GatewayError({
      code: 'provider_timeout',
      message: 'Provider timed out',
      providerStatus: status,
      details,
    });
  }

  if (status === 429) {
    return new GatewayError({
      code: 'rate_limited',
      message: 'Provider rate limit exceeded',
      providerStatus: status,
      details,
    });
  }

  if (status === 400 || status === 422) {
    return new GatewayError({
      code: 'invalid_request',
      message: `Provider rejected the request (${status})`,
      providerStatus: status,
      details,
      retryable: false,
    });
  }

  return new GatewayError({
    code: 'upstream_error',
    message: `Provider returned ${status}`,
    providerStatus: status,
    details,
    retryable: status >= 500 || status === 404,
  });
}

function mapTransportError(
  error: unknown,
  options: ChatOptions,
  timeoutSignal: AbortSignal,
): GatewayError {
  if (options.signal?.aborted) {
    return new GatewayError({
      code: 'client_disconnected',
      message: 'Client aborted the request',
      cause: error,
    });
  }

  if (
    timeoutSignal.aborted ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return new GatewayError({
      code: 'provider_timeout',
      message: `Provider did not respond within ${options.timeoutMs} ms`,
      retryable: true,
      cause: error,
    });
  }

  return new GatewayError({
    code: 'provider_unavailable',
    message: 'Provider is unreachable',
    retryable: true,
    cause: error,
  });
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'error':
      return 'error';
    default:
      return 'unknown';
  }
}
