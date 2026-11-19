import type {
  AttemptStatus,
  RequestAttempt,
  RequestLog,
  RequestLogDetails,
  RequestStatus,
} from '../data/types'

const BACKEND_HINT = 'Проверьте, что backend запущен на http://localhost:3000.'

const REQUEST_STATUSES: readonly RequestStatus[] = [
  'success',
  'error',
  'timeout',
  'cancelled',
]

const ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  'success',
  'error',
  'timeout',
  'skipped',
]

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && REQUEST_STATUSES.includes(value as RequestStatus)
}

function isAttemptStatus(value: unknown): value is AttemptStatus {
  return typeof value === 'string' && ATTEMPT_STATUSES.includes(value as AttemptStatus)
}

function parseRequestLog(value: unknown): RequestLog | null {
  if (!isRecord(value)) {
    return null
  }

  const {
    id,
    requestId,
    requestedModel,
    actualModel,
    clientName,
    providerName,
    status,
    errorCode,
    costMicros,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs,
    ttftMs,
    isStream,
    createdAt,
  } = value

  if (
    typeof id !== 'string' ||
    typeof requestId !== 'string' ||
    typeof requestedModel !== 'string' ||
    !isNullableString(actualModel) ||
    !isNullableString(clientName) ||
    !isNullableString(providerName) ||
    !isRequestStatus(status) ||
    !isNullableString(errorCode) ||
    typeof costMicros !== 'number' ||
    typeof promptTokens !== 'number' ||
    typeof completionTokens !== 'number' ||
    typeof totalTokens !== 'number' ||
    typeof latencyMs !== 'number' ||
    !(ttftMs === null || typeof ttftMs === 'number') ||
    typeof isStream !== 'boolean' ||
    typeof createdAt !== 'string'
  ) {
    return null
  }

  return {
    id,
    requestId,
    requestedModel,
    actualModel,
    clientName,
    providerName,
    status,
    errorCode,
    costMicros,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs,
    ttftMs,
    isStream,
    createdAt,
  }
}

function parseRequestAttempt(value: unknown): RequestAttempt | null {
  if (!isRecord(value)) {
    return null
  }

  const {
    attemptNo,
    providerName,
    status,
    httpStatus,
    errorCode,
    latencyMs,
    createdAt,
  } = value

  if (
    typeof attemptNo !== 'number' ||
    !isNullableString(providerName) ||
    !isAttemptStatus(status) ||
    !(httpStatus === null || typeof httpStatus === 'number') ||
    !isNullableString(errorCode) ||
    typeof latencyMs !== 'number' ||
    typeof createdAt !== 'string'
  ) {
    return null
  }

  return {
    attemptNo,
    providerName,
    status,
    httpStatus,
    errorCode,
    latencyMs,
    createdAt,
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()

    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === 'string'
    ) {
      return payload.error.message
    }
  } catch {
    // Тело ответа могло быть не JSON — ниже вернём общий текст.
  }

  return `Backend ответил HTTP ${response.status}. ${BACKEND_HINT}`
}

async function requestJson(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    })
  } catch {
    throw new ApiError(`Не удалось соединиться с backend. ${BACKEND_HINT}`, 0)
  }
}

export async function fetchRequestLogs(): Promise<RequestLog[]> {
  const response = await requestJson('/api/requests')

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status)
  }

  const payload: unknown = await response.json()

  if (!isRecord(payload) || !Array.isArray(payload.requests)) {
    throw new ApiError('Backend вернул журнал в неизвестном формате.', response.status)
  }

  return payload.requests
    .map(parseRequestLog)
    .filter((item): item is RequestLog => item !== null)
}

export async function fetchRequestLogDetails(
  requestId: string,
): Promise<RequestLogDetails | null> {
  const response = await requestJson(`/api/requests/${encodeURIComponent(requestId)}`)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status)
  }

  const payload: unknown = await response.json()
  const log = parseRequestLog(payload)

  if (log === null || !isRecord(payload) || !Array.isArray(payload.attempts)) {
    throw new ApiError('Backend вернул запрос в неизвестном формате.', response.status)
  }

  const attempts = payload.attempts
    .map(parseRequestAttempt)
    .filter((item): item is RequestAttempt => item !== null)

  return {
    ...log,
    attempts,
  }
}

export function describeApiError(caught: unknown): string {
  if (caught instanceof ApiError) {
    return caught.message
  }

  return caught instanceof Error
    ? caught.message
    : 'Не удалось загрузить журнал запросов.'
}
