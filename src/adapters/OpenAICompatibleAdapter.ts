import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { GatewayError } from '../core/errors.js';
import type {
  ChatOptions,
  ChatStreamChunk,
  ChatUsage,
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

const openAIStreamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
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

    const body = buildRequestBody(request, false);

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
    request: ProviderChatRequest,
    options: ChatOptions,
  ): AsyncIterable<ChatStreamChunk> {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
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
          body: JSON.stringify(buildRequestBody(request, true)),
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

    if (response.body === null) {
      throw new GatewayError({
        code: 'upstream_error',
        message: 'Provider returned an empty stream',
        providerStatus: response.status,
        retryable: true,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: FinishReason = 'unknown';
    let usage: ChatUsage | undefined;

    try {
      outer: while (true) {
        let result: Awaited<ReturnType<typeof reader.read>>;

        try {
          result = await reader.read();
        } catch (error) {
          throw mapStreamReadError(error, options, timeoutSignal);
        }

        if (result.done) {
          break;
        }

        buffer += decoder.decode(result.value, { stream: true });

        // SSE-события разделяются пустой строкой. Один `read()` может
        // принести половину события, поэтому разбираем только полные
        // блоки, а остаток оставляем в буфере до следующего чтения.
        let separator = /\r?\n\r?\n/.exec(buffer);

        while (separator !== null) {
          const event = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);

          const parsed = parseStreamEvent(event, response.status);

          if (parsed.done) {
            break outer;
          }

          if (parsed.delta !== undefined) {
            yield { type: 'delta', content: parsed.delta };
          }
          if (parsed.finishReason !== undefined) {
            finishReason = parsed.finishReason;
          }
          if (parsed.usage !== undefined) {
            usage = parsed.usage;
          }

          separator = /\r?\n\r?\n/.exec(buffer);
        }
      }

      // Провайдер мог закрыть поток без завершающей пустой строки.
      buffer += decoder.decode();

      if (buffer.trim().length > 0) {
        const parsed = parseStreamEvent(buffer, response.status);

        if (!parsed.done) {
          if (parsed.delta !== undefined) {
            yield { type: 'delta', content: parsed.delta };
          }
          if (parsed.finishReason !== undefined) {
            finishReason = parsed.finishReason;
          }
          if (parsed.usage !== undefined) {
            usage = parsed.usage;
          }
        }
      }
    } finally {
      // Если потребитель перестал читать (например, клиент закрыл
      // соединение), отменяем upstream-запрос и освобождаем reader.
      try {
        await reader.cancel();
      } catch {
        // Отмена уже завершённого потока не является ошибкой.
      }

      reader.releaseLock();
    }

    yield {
      type: 'done',
      finishReason,
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}

interface ParsedStreamEvent {
  delta?: string;
  finishReason?: FinishReason;
  usage?: ChatUsage;
  done: boolean;
}

/**
 * Разбирает один SSE-блок от OpenAI-совместимого провайдера.
 *
 * OpenAI присылает JSON в строке `data:`. Строки-комментарии (`: ping`)
 * и прочие поля SSE нас не интересуют. Несколько `data:`-строк
 * склеиваются через перевод строки, как требует спецификация SSE.
 */
function parseStreamEvent(
  event: string,
  providerStatus: number,
): ParsedStreamEvent {
  const dataLines: string[] = [];

  for (const line of event.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return { done: false };
  }

  const data = dataLines.join('\n').trim();

  if (data === '') {
    return { done: false };
  }

  if (data === '[DONE]') {
    return { done: true };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(data);
  } catch (error) {
    throw new GatewayError({
      code: 'upstream_error',
      message: 'Provider returned invalid stream data',
      providerStatus,
      retryable: true,
      cause: error,
    });
  }

  const parsed = openAIStreamChunkSchema.safeParse(payload);

  if (!parsed.success) {
    throw new GatewayError({
      code: 'upstream_error',
      message: 'Provider returned an unexpected stream chunk',
      providerStatus,
      details: parsed.error.issues,
      retryable: true,
    });
  }

  const result: ParsedStreamEvent = { done: false };
  const choice = parsed.data.choices?.[0];

  if (choice !== undefined) {
    const content = choice.delta?.content;

    if (typeof content === 'string' && content.length > 0) {
      result.delta = content;
    }

    if (
      choice.finish_reason !== null &&
      choice.finish_reason !== undefined
    ) {
      result.finishReason = mapFinishReason(choice.finish_reason);
    }
  }

  if (parsed.data.usage !== undefined) {
    result.usage = toChatUsage(parsed.data.usage);
  }

  return result;
}

function buildRequestBody(
  request: ProviderChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.upstreamModel,
    messages: request.messages,
    stream,
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

  if (stream) {
    // Просим провайдера прислать usage отдельным финальным чанком.
    // Без этого в streaming-режиме токены часто неизвестны.
    body.stream_options = { include_usage: true };
  }

  return body;
}

function toChatUsage(usage: {
  prompt_tokens?: number | undefined;
  completion_tokens?: number | undefined;
  total_tokens?: number | undefined;
}): ChatUsage {
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
  };
}

function mapStreamReadError(
  error: unknown,
  options: ChatOptions,
  timeoutSignal: AbortSignal,
): GatewayError {
  if (options.signal?.aborted) {
    return new GatewayError({
      code: 'client_disconnected',
      message: 'Client aborted the stream',
      cause: error,
    });
  }

  if (
    timeoutSignal.aborted ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return new GatewayError({
      code: 'provider_timeout',
      message: `Provider stream did not finish within ${options.timeoutMs} ms`,
      retryable: true,
      cause: error,
    });
  }

  return new GatewayError({
    code: 'upstream_error',
    message: 'Provider stream failed',
    retryable: true,
    cause: error,
  });
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
