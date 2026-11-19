export type ProviderStatus = 'active' | 'cooldown' | 'disabled'

export interface Provider {
  id: string
  name: string
  baseUrl: string
  status: ProviderStatus
  models: number
  keys: number
  latencyMs: number
  description: string
}

export type RouteStatus = 'active' | 'disabled'

export interface ModelRoute {
  id: string
  alias: string
  provider: string
  upstreamModel: string
  priority: number
  inputPriceMicrosPer1m: number
  outputPriceMicrosPer1m: number
  status: RouteStatus
}

export type RequestStatus = 'success' | 'error' | 'timeout' | 'cancelled'
export type AttemptStatus = 'success' | 'error' | 'timeout' | 'skipped'

export interface RequestLog {
  id: string
  requestId: string
  requestedModel: string
  actualModel: string | null
  clientName: string | null
  providerName: string | null
  status: RequestStatus
  errorCode: string | null
  costMicros: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  ttftMs: number | null
  isStream: boolean
  createdAt: string
}

export interface RequestAttempt {
  attemptNo: number
  providerName: string | null
  status: AttemptStatus
  httpStatus: number | null
  errorCode: string | null
  latencyMs: number
  createdAt: string
}

export interface RequestLogDetails extends RequestLog {
  attempts: RequestAttempt[]
}
