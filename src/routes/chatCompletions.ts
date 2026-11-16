import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';

import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
} from 'fastify';
import { z } from 'zod';

import type {
  AuthenticatedClient,
  ClientAuthenticator,
} from '../auth/clientAuth.js';
import {
  GatewayError,
  toGatewayError,
  type GatewayErrorCode,
} from '../core/errors.js';
import type {
  RateLimitDecision,
  RateLimiter,
} from '../core/RateLimiter.js';
import type { RouterAttempt, RouterChatOptions } from '../core/Router.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ChatUsage,
  FinishReason,
} from '../core/types.js';
import type {
  RequestAttemptRecord,
  RequestLogRecord,
  RequestLogRepository,
} from '../db/requestLogRepository.js';

/**
 * Интерфейс, который нужен HTTP-слою от Router.
 * Благодаря этому тесты могут подставить фейковый Router,
 * а приложение не зависит от конкретного класса.
 */
export interface ChatCompletionHandler {
  chat(
    request: ChatRequest,
    options?: RouterChatOptions,
  ): Promise<ChatResponse>;
  /**
   * Streaming необязателен: старые фейки и тесты могут реализовывать
   * только `chat`. Если метода нет, запрос со `stream: true` получит
   * понятную ошибку конфигурации.
   */
  chatStream?(
    request: ChatRequest,
    options?: RouterChatOptions,
  ): AsyncIterable<ChatStreamChunk>;
}

export interface ChatCompletionDependencies {
  router?: ChatCompletionHandler;
  authenticateClient?: ClientAuthenticator;
  rateLimiter?: RateLimiter;
  /**
   * Журнал запросов. Необязателен: если его нет, шлюз работает
   * как раньше, просто не сохраняет историю.
   */
  requestLogs?: RequestLogRepository;
}

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/**
 * Тело запроса в формате OpenAI Chat Completions.
 *
 * Наружу мы используем snake_case (`max_tokens`, `top_p`),
 * потому что так работает OpenAI SDK. Внутри домена — camelCase.
 */
export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  stream: z.boolean().optional(),
});

export type ChatCompletionRequestBody = z.infer<
  typeof chatCompletionRequestSchema
>;

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: FinishReason;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  provider: string;
  latency_ms: number;
  cost_micros: number;
}

export interface ChatCompletionErrorResponse {
  error: {
    message: string;
    type: string;
    code: GatewayErrorCode;
    provider_status?: number;
  };
}

export function registerChatCompletionRoute(
  app: FastifyInstance,
  dependencies: ChatCompletionDependencies,
): void {
  app.post('/v1/chat/completions', async (request, reply) => {
    const requestId = randomUUID();
    const startedAt = performance.now();

    // X-Request-Id полезен и клиенту, и нам: по нему можно найти
    // запись в request_logs и все попытки в request_attempts.
    reply.header('X-Request-Id', requestId);

    if (dependencies.authenticateClient === undefined) {
      const error = new GatewayError({
        code: 'internal_error',
        message: 'Client authentication is not configured',
      });

      return reply.status(error.httpStatus).send(toErrorResponse(error));
    }

    let client: AuthenticatedClient;

    try {
      client = await dependencies.authenticateClient(
        request.headers.authorization,
      );
    } catch (error) {
      const gatewayError = toGatewayError(error);

      request.log.warn(
        { err: gatewayError, code: gatewayError.code },
        'client authentication failed',
      );

      return reply
        .status(gatewayError.httpStatus)
        .send(toErrorResponse(gatewayError));
    }

    request.log.debug(
      { clientId: client.id, clientName: client.name },
      'client authenticated',
    );

    if (dependencies.rateLimiter === undefined) {
      const error = new GatewayError({
        code: 'internal_error',
        message: 'Rate limiter is not configured',
      });

      return reply.status(error.httpStatus).send(toErrorResponse(error));
    }

    const rateLimit = dependencies.rateLimiter.check(
      client.id,
      client.rateLimitRpm,
    );

    reply.header('X-RateLimit-Limit', String(rateLimit.limit));
    reply.header('X-RateLimit-Remaining', String(rateLimit.remaining));
    reply.header(
      'X-RateLimit-Reset',
      String(Math.ceil(rateLimit.resetAt / 1_000)),
    );

    if (!rateLimit.allowed) {
      const error = new GatewayError({
        code: 'rate_limited',
        message: `Rate limit exceeded: ${rateLimit.limit} request(s) per minute`,
      });

      request.log.warn(
        { clientId: client.id, limit: rateLimit.limit },
        'client rate limit exceeded',
      );

      return reply
        .status(error.httpStatus)
        .header('Retry-After', String(rateLimit.retryAfterSeconds))
        .send(toErrorResponse(error));
    }

    const parsed = chatCompletionRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      const error = new GatewayError({
        code: 'invalid_request',
        message: formatValidationError(parsed.error),
        details: parsed.error.issues,
      });

      request.log.warn(
        { issues: parsed.error.issues },
        'invalid chat completion request',
      );

      return reply.status(error.httpStatus).send(toErrorResponse(error));
    }

    if (dependencies.router === undefined) {
      const error = new GatewayError({
        code: 'internal_error',
        message: 'Router is not configured',
      });

      return reply.status(error.httpStatus).send(toErrorResponse(error));
    }

    const attempts: RouterAttempt[] = [];
    const chatRequest = toChatRequest(parsed.data);

    if (parsed.data.stream === true) {
      if (dependencies.router.chatStream === undefined) {
        const error = new GatewayError({
          code: 'internal_error',
          message: 'Streaming is not supported by the configured router',
        });

        return reply.status(error.httpStatus).send(toErrorResponse(error));
      }

      await handleStreamingCompletion({
        reply,
        logger: request.log,
        router: dependencies.router,
        requestLogs: dependencies.requestLogs,
        requestId,
        startedAt,
        client,
        rateLimit,
        body: parsed.data,
        chatRequest,
        attempts,
      });

      return reply;
    }

    try {
      const response = await dependencies.router.chat(chatRequest, {
        onAttempt: (attempt) => {
          attempts.push(attempt);
        },
      });

      await persistRequestLog(dependencies.requestLogs, request.log, {
        requestId,
        clientId: client.id,
        requestedModel: parsed.data.model,
        actualModel: lastAttempt(attempts)?.upstreamModel ?? response.model,
        providerId: lastAttempt(attempts)?.providerId ?? null,
        apiKeyId: lastAttempt(attempts)?.apiKeyId ?? null,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        costMicros: response.costMicros,
        latencyMs: Math.round(performance.now() - startedAt),
        ttftMs: response.ttftMs ?? null,
        status: 'success',
        errorCode: null,
        isStream: false,
        attempts: toAttemptRecords(attempts),
      });

      return reply.send(
        toChatCompletionResponse(response, parsed.data.model),
      );
    } catch (error) {
      const gatewayError = toGatewayError(error);

      await persistRequestLog(dependencies.requestLogs, request.log, {
        requestId,
        clientId: client.id,
        requestedModel: parsed.data.model,
        actualModel: lastAttempt(attempts)?.upstreamModel ?? null,
        providerId: lastAttempt(attempts)?.providerId ?? null,
        apiKeyId: lastAttempt(attempts)?.apiKeyId ?? null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: 0,
        latencyMs: Math.round(performance.now() - startedAt),
        ttftMs: null,
        status: requestStatusFromError(gatewayError, attempts),
        errorCode: gatewayError.code,
        isStream: false,
        attempts: toAttemptRecords(attempts),
      });

      request.log.warn(
        { err: gatewayError, code: gatewayError.code, requestId },
        'chat completion failed',
      );

      return reply
        .status(gatewayError.httpStatus)
        .send(toErrorResponse(gatewayError));
    }
  });
}

interface StreamingCompletionParams {
  reply: FastifyReply;
  logger: FastifyBaseLogger;
  router: ChatCompletionHandler;
  requestLogs: RequestLogRepository | undefined;
  requestId: string;
  startedAt: number;
  client: AuthenticatedClient;
  rateLimit: RateLimitDecision;
  body: ChatCompletionRequestBody;
  chatRequest: ChatRequest;
  attempts: RouterAttempt[];
}

interface StreamingLogResult {
  ttftMs: number | null;
  usage: ChatUsage | undefined;
  costMicros: number;
  status: RequestLogRecord['status'];
  errorCode: GatewayErrorCode | null;
}

/**
 * Отдаёт клиенту SSE-поток.
 *
 * Сначала ждём первый чанк от Router. Пока он не пришёл, ошибку
 * ещё можно вернуть обычным JSON-ответом с корректным HTTP-статусом.
 * После первого чанка заголовки уже отправлены, поэтому ошибка
 * сообщается событием `event: error`.
 */
async function handleStreamingCompletion(
  params: StreamingCompletionParams,
): Promise<void> {
  const { reply, router } = params;
  const chatStream = router.chatStream;

  if (chatStream === undefined) {
    const error = new GatewayError({
      code: 'internal_error',
      message: 'Streaming is not supported by the configured router',
    });

    reply.status(error.httpStatus).send(toErrorResponse(error));
    return;
  }

  const controller = new AbortController();
  let finished = false;

  const onClose = (): void => {
    if (!finished) {
      controller.abort();
    }
  };

  // Если клиент закроет соединение, upstream-запрос должен быть
  // отменён, а не продолжать генерировать токены в пустоту.
  reply.raw.once('close', onClose);

  const iterator = chatStream
    .call(router, params.chatRequest, {
      signal: controller.signal,
      onAttempt: (attempt) => {
        params.attempts.push(attempt);
      },
    })
    [Symbol.asyncIterator]();

  let first: IteratorResult<ChatStreamChunk>;

  try {
    first = await iterator.next();
  } catch (error) {
    const gatewayError = toGatewayError(error);

    finished = true;
    reply.raw.off('close', onClose);
    await closeIterator(iterator);

    await persistStreamLog(params, {
      ttftMs: null,
      usage: undefined,
      costMicros: 0,
      status: requestStatusFromError(gatewayError, params.attempts),
      errorCode: gatewayError.code,
    });

    params.logger.warn(
      {
        err: gatewayError,
        code: gatewayError.code,
        requestId: params.requestId,
      },
      'streaming chat completion failed before first chunk',
    );

    if (gatewayError.code === 'client_disconnected') {
      reply.hijack();

      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
      return;
    }

    reply.status(gatewayError.httpStatus).send(toErrorResponse(gatewayError));
    return;
  }

  const ttftMs = Math.round(performance.now() - params.startedAt);

  reply.hijack();

  const created = Math.floor(Date.now() / 1_000);
  const id = `chatcmpl-${params.requestId}`;

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Request-Id': params.requestId,
    'X-RateLimit-Limit': String(params.rateLimit.limit),
    'X-RateLimit-Remaining': String(params.rateLimit.remaining),
    'X-RateLimit-Reset': String(
      Math.ceil(params.rateLimit.resetAt / 1_000),
    ),
  });

  let finishReason: FinishReason = 'unknown';
  let usage: ChatUsage | undefined;
  let costMicros = 0;

  try {
    await writeSse(
      reply.raw,
      formatSseData(roleChunk(id, created, params.body.model)),
    );

    let current = first;

    while (!current.done) {
      const chunk = current.value;

      if (chunk.type === 'delta') {
        if (chunk.content.length > 0) {
          await writeSse(
            reply.raw,
            formatSseData(
              deltaChunk(id, created, params.body.model, chunk.content),
            ),
          );
        }
      } else {
        finishReason = chunk.finishReason;
        costMicros = chunk.costMicros ?? 0;

        if (chunk.usage !== undefined) {
          usage = chunk.usage;
        }
      }

      current = await iterator.next();
    }

    await writeSse(
      reply.raw,
      formatSseData(
        finalChunk(
          id,
          created,
          params.body.model,
          finishReason,
          usage,
          costMicros,
        ),
      ),
    );
    await writeSse(reply.raw, SSE_DONE);

    finished = true;
    reply.raw.off('close', onClose);
    reply.raw.end();

    await persistStreamLog(params, {
      ttftMs,
      usage,
      costMicros,
      status: 'success',
      errorCode: null,
    });
  } catch (error) {
    const gatewayError = controller.signal.aborted
      ? new GatewayError({
          code: 'client_disconnected',
          message: 'Client disconnected during the stream',
          cause: error,
        })
      : toGatewayError(error);

    finished = true;
    reply.raw.off('close', onClose);

    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      try {
        await writeSse(reply.raw, formatSseError(gatewayError));
        await writeSse(reply.raw, SSE_DONE);
        reply.raw.end();
      } catch {
        // Клиент уже мог отключиться.
      }
    }

    await persistStreamLog(params, {
      ttftMs,
      usage,
      costMicros,
      status: requestStatusFromError(gatewayError, params.attempts),
      errorCode: gatewayError.code,
    });

    params.logger.warn(
      {
        err: gatewayError,
        code: gatewayError.code,
        requestId: params.requestId,
      },
      'streaming chat completion failed',
    );
  } finally {
    finished = true;
    reply.raw.off('close', onClose);
    await closeIterator(iterator);
  }
}

async function persistStreamLog(
  params: StreamingCompletionParams,
  result: StreamingLogResult,
): Promise<void> {
  const last = lastAttempt(params.attempts);

  await persistRequestLog(params.requestLogs, params.logger, {
    requestId: params.requestId,
    clientId: params.client.id,
    requestedModel: params.body.model,
    actualModel: last?.upstreamModel ?? null,
    providerId: last?.providerId ?? null,
    apiKeyId: last?.apiKeyId ?? null,
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
    totalTokens: result.usage?.totalTokens ?? 0,
    costMicros: result.costMicros,
    latencyMs: Math.round(performance.now() - params.startedAt),
    ttftMs: result.ttftMs,
    status: result.status,
    errorCode: result.errorCode,
    isStream: true,
    attempts: toAttemptRecords(params.attempts),
  });
}

interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
    };
    finish_reason: FinishReason | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost_micros?: number;
}

function roleChunk(
  id: string,
  created: number,
  model: string,
): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  };
}

function deltaChunk(
  id: string,
  created: number,
  model: string,
  content: string,
): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}

function finalChunk(
  id: string,
  created: number,
  model: string,
  finishReason: FinishReason,
  usage: ChatUsage | undefined,
  costMicros: number,
): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
    cost_micros: costMicros,
    ...(usage !== undefined
      ? {
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens,
          },
        }
      : {}),
  };
}

const SSE_DONE = 'data: [DONE]\n\n';

function formatSseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function formatSseError(error: GatewayError): string {
  return `event: error\ndata: ${JSON.stringify(toErrorResponse(error))}\n\n`;
}

/**
 * Пишет SSE-блок в сырой ответ и учитывает backpressure.
 *
 * `write()` возвращает false, когда буфер сокета заполнен. В этом
 * случае ждём `drain`. `close` тоже завершает ожидание: клиент мог
 * отключиться, и следующий `iterator.next()` увидит abort.
 */
function writeSse(res: ServerResponse, payload: string): Promise<void> {
  if (res.destroyed || res.writableEnded) {
    return Promise.resolve();
  }

  if (res.write(payload)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = (): void => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };

    res.once('drain', done);
    res.once('close', done);
  });
}

async function closeIterator(
  iterator: AsyncIterator<ChatStreamChunk>,
): Promise<void> {
  if (typeof iterator.return !== 'function') {
    return;
  }

  try {
    await iterator.return();
  } catch {
    // Закрытие итератора — вспомогательная операция.
  }
}

export function toChatRequest(
  body: ChatCompletionRequestBody,
): ChatRequest {
  const request: ChatRequest = {
    model: body.model,
    messages: body.messages,
  };

  if (body.temperature !== undefined) {
    request.temperature = body.temperature;
  }
  if (body.max_tokens !== undefined) {
    request.maxTokens = body.max_tokens;
  }
  if (body.top_p !== undefined) {
    request.topP = body.top_p;
  }
  if (body.stop !== undefined) {
    request.stop = body.stop;
  }
  if (body.stream !== undefined) {
    request.stream = body.stream;
  }

  return request;
}

export function toChatCompletionResponse(
  response: ChatResponse,
  requestedModel: string,
  created: number = Math.floor(Date.now() / 1000),
): ChatCompletionResponse {
  return {
    id: response.id,
    object: 'chat.completion',
    created,
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: response.content,
        },
        finish_reason: response.finishReason,
      },
    ],
    usage: {
      prompt_tokens: response.usage.promptTokens,
      completion_tokens: response.usage.completionTokens,
      total_tokens: response.usage.totalTokens,
    },
    provider: response.provider,
    latency_ms: response.latencyMs,
    cost_micros: response.costMicros,
  };
}

export function toErrorResponse(
  error: GatewayError,
): ChatCompletionErrorResponse {
  const response: ChatCompletionErrorResponse = {
    error: {
      message: error.message,
      type: errorType(error.code),
      code: error.code,
    },
  };

  if (error.providerStatus !== undefined) {
    response.error.provider_status = error.providerStatus;
  }

  return response;
}

function lastAttempt(attempts: RouterAttempt[]): RouterAttempt | undefined {
  return attempts.at(-1);
}

function toAttemptRecords(
  attempts: RouterAttempt[],
): RequestAttemptRecord[] {
  return attempts.map((attempt) => ({
    attemptNo: attempt.attemptNo,
    providerId: attempt.providerId,
    apiKeyId: attempt.apiKeyId,
    status: attempt.status,
    httpStatus: attempt.httpStatus ?? null,
    errorCode: attempt.errorCode ?? null,
    latencyMs: attempt.latencyMs,
  }));
}

function requestStatusFromError(
  error: GatewayError,
  attempts: RouterAttempt[],
): RequestLogRecord['status'] {
  if (error.code === 'client_disconnected') {
    return 'cancelled';
  }

  if (
    error.code === 'provider_timeout' ||
    lastAttempt(attempts)?.status === 'timeout'
  ) {
    return 'timeout';
  }

  return 'error';
}

async function persistRequestLog(
  repository: RequestLogRepository | undefined,
  logger: FastifyBaseLogger,
  record: RequestLogRecord,
): Promise<void> {
  if (repository === undefined) {
    return;
  }

  try {
    await repository.save(record);
  } catch (error) {
    // Журнал — вспомогательная функция. Ошибка записи в БД не должна
    // превращать успешный ответ провайдера в ошибку для клиента.
    logger.error(
      { err: error, requestId: record.requestId },
      'failed to persist request log',
    );
  }
}

function formatValidationError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.join('.') || 'body';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

  return `Invalid request body: ${details}`;
}

function errorType(code: GatewayErrorCode): string {
  switch (code) {
    case 'invalid_request':
    case 'no_route':
      return 'invalid_request_error';
    case 'unauthorized':
      return 'authentication_error';
    case 'forbidden':
      return 'permission_error';
    case 'rate_limited':
      return 'rate_limit_error';
    default:
      return 'api_error';
  }
}
