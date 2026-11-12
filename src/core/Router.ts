import { GatewayError, toGatewayError } from './errors.js';
import type { KeyPool } from './KeyPool.js';
import type {
  ChatOptions,
  ChatRequest,
  ChatResponse,
  CompletionParams,
  LLMProviderAdapter,
  ProviderChatRequest,
} from './types.js';

/**
 * Один конкретный deployment: провайдер + upstream-модель + пул ключей.
 *
 * Router не знает, откуда взялся deployment. Его может собрать
 * resolver из БД, из конфига или из тестового массива.
 */
export interface RouterDeployment {
  providerId: string;
  upstreamModel: string;
  priority: number;
  adapter: LLMProviderAdapter;
  keyPool: KeyPool;
  baseUrl: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export type DeploymentResolver = (
  alias: string,
) => Promise<ReadonlyArray<RouterDeployment>> | ReadonlyArray<RouterDeployment>;

export interface RouterOptions {
  /**
   * На сколько миллисекунд отправлять ключ в cooldown после 429.
   */
  cooldownMs?: number;
  /**
   * Общий лимит попыток на один запрос. Защищает от ситуации,
   * когда много deployment'ов и много ключей превращают один
   * запрос в десятки исходящих вызовов.
   */
  maxAttempts?: number;
}

export interface RouterChatOptions {
  signal?: AbortSignal;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 6;

const KEY_SPECIFIC_ERRORS: ReadonlySet<GatewayError['code']> = new Set([
  'rate_limited',
  'unauthorized',
  'forbidden',
]);

const TERMINAL_ERRORS: ReadonlySet<GatewayError['code']> = new Set([
  'invalid_request',
  'client_disconnected',
  'internal_error',
  'no_route',
  'all_providers_failed',
]);

/**
 * Ядро шлюза.
 *
 * Router получает список deployment'ов по alias, сортирует их по priority,
 * берёт ключ из пула и вызывает адаптер. В зависимости от кода ошибки он
 * решает, что делать дальше:
 *
 * - 429 / 401 / 403 — проблема ключа: попробовать следующий ключ;
 * - timeout / 5xx / network — проблема deployment'а: перейти к следующему;
 * - 400 / отмена клиентом — повторять бессмысленно: остановиться.
 *
 * Router не работает с HTTP и не пишет в БД. Он возвращает нормализованный
 * ответ или `GatewayError`, а логированием займётся слой выше.
 */
export class Router {
  private readonly cooldownMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly resolveDeployments: DeploymentResolver,
    options: RouterOptions = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    if (this.cooldownMs < 0) {
      throw new Error('cooldownMs must be non-negative');
    }

    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer');
    }
  }

  async chat(
    request: ChatRequest,
    options: RouterChatOptions = {},
  ): Promise<ChatResponse> {
    if (request.stream === true) {
      throw new GatewayError({
        code: 'invalid_request',
        message: 'Streaming is not implemented yet',
      });
    }

    const resolved = await this.resolveDeploymentsSafely(request.model);
    const deployments = [...resolved].sort(
      (left, right) => left.priority - right.priority,
    );

    if (deployments.length === 0) {
      throw new GatewayError({
        code: 'no_route',
        message: `No route configured for model "${request.model}"`,
      });
    }

    const completion = buildCompletionParams(request);
    let attempts = 0;
    let lastError: GatewayError | undefined;

    for (const deployment of deployments) {
      const attemptedKeys = new Set<string>();

      while (attempts < this.maxAttempts) {
        const key = deployment.keyPool.acquire();

        if (key === null || attemptedKeys.has(key.id)) {
          break;
        }

        attemptedKeys.add(key.id);
        attempts += 1;

        const providerRequest: ProviderChatRequest = {
          ...completion,
          upstreamModel: deployment.upstreamModel,
        };

        try {
          const response = await deployment.adapter.chat(
            providerRequest,
            buildChatOptions(deployment, key.value, options),
          );

          deployment.keyPool.reportSuccess(key.id);

          return {
            ...response,
            requestedModel: request.model,
          };
        } catch (error) {
          const gatewayError = toGatewayError(error);
          lastError = gatewayError;

          this.reportKeyFailure(deployment.keyPool, key.id, gatewayError);

          if (TERMINAL_ERRORS.has(gatewayError.code)) {
            throw gatewayError;
          }

          if (KEY_SPECIFIC_ERRORS.has(gatewayError.code)) {
            // Проблема конкретного ключа: следующий acquire() выдаст
            // другой ключ этого же провайдера, если он доступен.
            continue;
          }

          // Ошибка deployment'а: другой ключ того же провайдера
          // с большой вероятностью получит ту же ошибку.
          break;
        }
      }
    }

    if (lastError !== undefined) {
      throw new GatewayError({
        code: 'all_providers_failed',
        message:
          `All ${attempts} attempt(s) failed for model "${request.model}"`,
        details: {
          attempts,
          lastErrorCode: lastError.code,
          lastErrorMessage: lastError.message,
        },
        cause: lastError,
      });
    }

    throw new GatewayError({
      code: 'all_providers_failed',
      message: `No API keys available for model "${request.model}"`,
      details: {
        attempts,
        deployments: deployments.length,
      },
    });
  }

  private async resolveDeploymentsSafely(
    alias: string,
  ): Promise<ReadonlyArray<RouterDeployment>> {
    try {
      return await this.resolveDeployments(alias);
    } catch (error) {
      throw toGatewayError(error);
    }
  }

  private reportKeyFailure(
    keyPool: KeyPool,
    keyId: string,
    error: GatewayError,
  ): void {
    switch (error.code) {
      case 'rate_limited':
        keyPool.reportRateLimit(keyId, this.cooldownMs);
        return;
      case 'unauthorized':
      case 'forbidden':
        keyPool.reportInvalid(keyId);
        return;
      default:
        keyPool.reportFailure(keyId);
    }
  }
}

function buildCompletionParams(request: ChatRequest): CompletionParams {
  const params: CompletionParams = {
    messages: request.messages,
  };

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    params.maxTokens = request.maxTokens;
  }
  if (request.topP !== undefined) {
    params.topP = request.topP;
  }
  if (request.stop !== undefined) {
    params.stop = request.stop;
  }

  return params;
}

function buildChatOptions(
  deployment: RouterDeployment,
  apiKey: string,
  options: RouterChatOptions,
): ChatOptions {
  const chatOptions: ChatOptions = {
    apiKey,
    baseUrl: deployment.baseUrl,
    timeoutMs: deployment.timeoutMs,
  };

  if (options.signal !== undefined) {
    chatOptions.signal = options.signal;
  }
  if (deployment.headers !== undefined) {
    chatOptions.headers = deployment.headers;
  }

  return chatOptions;
}
