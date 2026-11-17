import { performance } from 'node:perf_hooks';

import { calculateCostMicros } from './cost.js';
import { GatewayError, toGatewayError } from './errors.js';
import type { KeyStateEvent, KeyStateObserver } from './keyState.js';
import type { KeyPool } from './KeyPool.js';
import type {
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
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
  /**
   * Цены модели за 1M токенов в микро-долларах.
   * Нужны Router'у, чтобы посчитать стоимость ответа.
   */
  inputPriceMicrosPer1m: number;
  outputPriceMicrosPer1m: number;
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
  /**
   * Наблюдатель за состоянием ключей.
   *
   * Router не пишет в БД: он сообщает, что ключ был успешно
   * использован, получил 429, стал невалидным или временно упал.
   * Слой `db` решает, как это сохранить.
   */
  onKeyState?: KeyStateObserver;
}

export interface RouterChatOptions {
  signal?: AbortSignal;
  /**
   * Наблюдатель за попытками. Router вызывает его после каждого
   * фактического обращения к провайдеру — и при успехе, и при ошибке.
   *
   * Это позволяет HTTP-слою собрать историю fallback'а и сохранить
   * её в request_attempts, не превращая Router в зависимость от БД.
   */
  onAttempt?: AttemptObserver;
}

export type RouterAttemptStatus = 'success' | 'error' | 'timeout';

/**
 * Одна фактическая попытка вызова провайдера.
 */
export interface RouterAttempt {
  attemptNo: number;
  providerId: string;
  apiKeyId: string;
  upstreamModel: string;
  status: RouterAttemptStatus;
  httpStatus?: number;
  errorCode?: GatewayError['code'];
  latencyMs: number;
}

export type AttemptObserver = (attempt: RouterAttempt) => void;

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
 * - серия таких ошибок открывает circuit breaker ключа: ключ уходит
 *   в cooldown и временно не выдаётся из пула;
 * - 400 / отмена клиентом — повторять бессмысленно: остановиться.
 *
 * Router не работает с HTTP и не пишет в БД. Он возвращает нормализованный
 * ответ или `GatewayError`, а обо всех попытках и изменениях состояния
 * ключей сообщает наблюдателям. Сохранением занимается слой выше.
 */
export class Router {
  private readonly cooldownMs: number;
  private readonly maxAttempts: number;
  private readonly onKeyState: KeyStateObserver | undefined;

  constructor(
    private readonly resolveDeployments: DeploymentResolver,
    options: RouterOptions = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.onKeyState = options.onKeyState;

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
        const attemptStartedAt = performance.now();

        try {
          const response = await deployment.adapter.chat(
            providerRequest,
            buildChatOptions(deployment, key.value, options),
          );

          const succeededAt = Date.now();

          deployment.keyPool.reportSuccess(key.id, succeededAt);

          reportKeyState(this.onKeyState, {
            keyId: key.id,
            type: 'success',
            at: succeededAt,
          });

          reportAttempt(options.onAttempt, {
            attemptNo: attempts,
            providerId: deployment.providerId,
            apiKeyId: key.id,
            upstreamModel: deployment.upstreamModel,
            status: 'success',
            httpStatus: 200,
            latencyMs: Math.round(performance.now() - attemptStartedAt),
          });

          return {
            ...response,
            requestedModel: request.model,
            costMicros: calculateCostMicros({
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              inputPriceMicrosPer1m:
                deployment.inputPriceMicrosPer1m,
              outputPriceMicrosPer1m:
                deployment.outputPriceMicrosPer1m,
            }),
          };
        } catch (error) {
          const gatewayError = toGatewayError(error);
          lastError = gatewayError;

          reportAttempt(options.onAttempt, {
            attemptNo: attempts,
            providerId: deployment.providerId,
            apiKeyId: key.id,
            upstreamModel: deployment.upstreamModel,
            status:
              gatewayError.code === 'provider_timeout' ? 'timeout' : 'error',
            ...(gatewayError.providerStatus !== undefined
              ? { httpStatus: gatewayError.providerStatus }
              : {}),
            errorCode: gatewayError.code,
            latencyMs: Math.round(performance.now() - attemptStartedAt),
          });

          if (TERMINAL_ERRORS.has(gatewayError.code)) {
            throw gatewayError;
          }

          this.reportKeyFailure(
            deployment.keyPool,
            key.id,
            gatewayError,
            Date.now(),
          );

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

  async *chatStream(
    request: ChatRequest,
    options: RouterChatOptions = {},
  ): AsyncIterable<ChatStreamChunk> {
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
        const attemptStartedAt = performance.now();
        const iterator = deployment.adapter
          .chatStream(
            providerRequest,
            buildChatOptions(deployment, key.value, options),
          )
          [Symbol.asyncIterator]();

        let first: IteratorResult<ChatStreamChunk>;

        try {
          // Ждём первый чанк до отправки HTTP-заголовков клиенту.
          // Пока чанка нет, ошибку ещё можно скрыть fallback'ом.
          first = await iterator.next();
        } catch (error) {
          await closeIterator(iterator);

          const gatewayError = toGatewayError(error);
          lastError = gatewayError;

          reportAttempt(options.onAttempt, {
            attemptNo: attempts,
            providerId: deployment.providerId,
            apiKeyId: key.id,
            upstreamModel: deployment.upstreamModel,
            status:
              gatewayError.code === 'provider_timeout' ? 'timeout' : 'error',
            ...(gatewayError.providerStatus !== undefined
              ? { httpStatus: gatewayError.providerStatus }
              : {}),
            errorCode: gatewayError.code,
            latencyMs: Math.round(performance.now() - attemptStartedAt),
          });

          if (TERMINAL_ERRORS.has(gatewayError.code)) {
            throw gatewayError;
          }

          this.reportKeyFailure(
            deployment.keyPool,
            key.id,
            gatewayError,
            Date.now(),
          );

          if (KEY_SPECIFIC_ERRORS.has(gatewayError.code)) {
            continue;
          }

          break;
        }

        const succeededAt = Date.now();

        deployment.keyPool.reportSuccess(key.id, succeededAt);

        reportKeyState(this.onKeyState, {
          keyId: key.id,
          type: 'success',
          at: succeededAt,
        });

        reportAttempt(options.onAttempt, {
          attemptNo: attempts,
          providerId: deployment.providerId,
          apiKeyId: key.id,
          upstreamModel: deployment.upstreamModel,
          status: 'success',
          httpStatus: 200,
          latencyMs: Math.round(performance.now() - attemptStartedAt),
        });

        try {
          if (!first.done) {
            yield withDeploymentCost(first.value, deployment);
          }

          while (true) {
            const next = await iterator.next();

            if (next.done) {
              break;
            }

            yield withDeploymentCost(next.value, deployment);
          }
        } finally {
          await closeIterator(iterator);
        }

        // После первого чанка fallback уже невозможен: заголовки
        // и часть тела ответа могли уйти клиенту.
        return;
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
    now: number,
  ): void {
    switch (error.code) {
      case 'rate_limited':
        keyPool.reportRateLimit(keyId, this.cooldownMs, now);
        reportKeyState(this.onKeyState, {
          keyId,
          type: 'rate_limited',
          at: now,
          cooldownUntil: now + this.cooldownMs,
        });
        return;
      case 'unauthorized':
      case 'forbidden':
        keyPool.reportInvalid(keyId);
        reportKeyState(this.onKeyState, {
          keyId,
          type: 'invalid',
          at: now,
        });
        return;
      default: {
        const result = keyPool.reportFailure(keyId, now);

        reportKeyState(this.onKeyState, {
          keyId,
          type: 'failure',
          at: now,
          ...(result.cooldownUntil !== undefined
            ? { cooldownUntil: result.cooldownUntil }
            : {}),
        });
      }
    }
  }
}

/**
 * Наблюдатель не должен ломать основной путь запроса.
 * Если он бросит исключение, Router продолжит работать так,
 * как будто попытка не была зарегистрирована.
 */
function reportAttempt(
  observer: AttemptObserver | undefined,
  attempt: RouterAttempt,
): void {
  if (observer === undefined) {
    return;
  }

  try {
    observer(attempt);
  } catch {
    // Логирование — вспомогательная операция, а не часть ответа клиенту.
  }
}

/**
 * Наблюдатель за ключами, как и наблюдатель за попытками,
 * не должен ломать основной путь запроса.
 */
function reportKeyState(
  observer: KeyStateObserver | undefined,
  event: KeyStateEvent,
): void {
  if (observer === undefined) {
    return;
  }

  try {
    observer(event);
  } catch {
    // Сохранение состояния ключа — вспомогательная операция.
  }
}

/**
 * Аккуратно закрывает итератор адаптера.
 *
 * Это важно для streaming: если клиент отключился или Router выбрал
 * другой deployment, upstream-запрос нужно отменить, а не оставить
 * висеть до таймаута.
 */
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

/**
 * Добавляет стоимость к финальному чанку потока.
 *
 * Адаптер не знает цен: он видит только usage. Router знает,
 * какой deployment сработал, поэтому именно здесь появляется
 * `costMicros`.
 */
function withDeploymentCost(
  chunk: ChatStreamChunk,
  deployment: RouterDeployment,
): ChatStreamChunk {
  if (chunk.type !== 'done') {
    return chunk;
  }

  return {
    ...chunk,
    costMicros: calculateCostMicros({
      promptTokens: chunk.usage?.promptTokens ?? 0,
      completionTokens: chunk.usage?.completionTokens ?? 0,
      inputPriceMicrosPer1m: deployment.inputPriceMicrosPer1m,
      outputPriceMicrosPer1m: deployment.outputPriceMicrosPer1m,
    }),
  };
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
