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

export type RequestStatus = 'success' | 'error' | 'pending'
export type AttemptStatus = 'success' | 'error' | 'timeout'

export interface RequestAttempt {
  attempt: number
  provider: string
  status: AttemptStatus
  errorCode: string | null
  latencyMs: number
}

export interface RequestLog {
  id: string
  requestId: string
  model: string
  client: string
  status: RequestStatus
  provider: string
  costMicros: number
  promptTokens: number
  completionTokens: number
  createdAt: string
  attempts: RequestAttempt[]
}
