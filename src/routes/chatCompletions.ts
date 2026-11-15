import type { FastifyInstance } from 'fastify';
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
import type { RateLimiter } from '../core/RateLimiter.js';
import type { RouterChatOptions } from '../core/Router.js';
import type {
  ChatRequest,
  ChatResponse,
  FinishReason,
} from '../core/types.js';

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
}

export interface ChatCompletionDependencies {
  router?: ChatCompletionHandler;
  authenticateClient?: ClientAuthenticator;
  rateLimiter?: RateLimiter;
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

    try {
      const response = await dependencies.router.chat(
        toChatRequest(parsed.data),
      );

      return reply.send(
        toChatCompletionResponse(response, parsed.data.model),
      );
    } catch (error) {
      const gatewayError = toGatewayError(error);

      request.log.warn(
        { err: gatewayError, code: gatewayError.code },
        'chat completion failed',
      );

      return reply
        .status(gatewayError.httpStatus)
        .send(toErrorResponse(gatewayError));
    }
  });
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
