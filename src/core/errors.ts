export type GatewayErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'upstream_error'
  | 'no_route'
  | 'all_providers_failed'
  | 'client_disconnected'
  | 'internal_error';

export interface GatewayErrorOptions {
  code: GatewayErrorCode;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
  providerStatus?: number;
  details?: unknown;
  cause?: unknown;
}

const DEFAULT_HTTP_STATUS: Record<GatewayErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  provider_timeout: 504,
  provider_unavailable: 503,
  upstream_error: 502,
  no_route: 404,
  all_providers_failed: 502,
  client_disconnected: 499,
  internal_error: 500,
};

const RETRYABLE_CODES: ReadonlySet<GatewayErrorCode> = new Set([
  'rate_limited',
  'provider_timeout',
  'provider_unavailable',
  'upstream_error',
  'all_providers_failed',
]);

/**
 * Единая ошибка шлюза.
 *
 * `retryable` — главный флаг для Router: можно ли пробовать следующий
 * ключ или следующего провайдера. HTTP-слой использует `httpStatus`,
 * а `providerStatus` сохраняет исходный код ответа провайдера для логов.
 */
export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly providerStatus: number | undefined;
  readonly details: unknown;

  constructor(options: GatewayErrorOptions) {
    super(
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = 'GatewayError';
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? DEFAULT_HTTP_STATUS[options.code];
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(options.code);
    this.providerStatus = options.providerStatus;
    this.details = options.details;
  }
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}

/**
 * Приводит любое исключение к GatewayError, чтобы HTTP-слой и Router
 * не зависели от случайных форматов ошибок.
 */
export function toGatewayError(error: unknown): GatewayError {
  if (isGatewayError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new GatewayError({
      code: 'internal_error',
      message: error.message,
      cause: error,
    });
  }

  return new GatewayError({
    code: 'internal_error',
    message: 'Unknown error',
    details: error,
  });
}
