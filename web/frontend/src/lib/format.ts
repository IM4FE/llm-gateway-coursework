import type { StatusTone } from '@llm-gateway/ui'

import type {
  AttemptStatus,
  ProviderStatus,
  RequestStatus,
  RouteStatus,
} from '../data/types'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(value: string): string {
  return dateFormatter.format(new Date(value))
}

export function formatMicros(micros: number): string {
  if (micros === 0) {
    return 'free'
  }

  return `$${(micros / 1_000_000).toFixed(6)}`
}

export function providerStatusLabel(status: ProviderStatus): string {
  switch (status) {
  case 'active':
    return 'active'
  case 'cooldown':
    return 'cooldown'
  case 'disabled':
    return 'disabled'
  }
}

export function providerStatusTone(status: ProviderStatus): StatusTone {
  switch (status) {
  case 'active':
    return 'success'
  case 'cooldown':
    return 'warning'
  case 'disabled':
    return 'neutral'
  }
}

export function routeStatusTone(status: RouteStatus): StatusTone {
  return status === 'active' ? 'success' : 'neutral'
}

export function requestStatusTone(status: RequestStatus): StatusTone {
  switch (status) {
  case 'success':
    return 'success'
  case 'error':
    return 'danger'
  case 'pending':
    return 'warning'
  }
}

export function attemptStatusTone(status: AttemptStatus): StatusTone {
  switch (status) {
  case 'success':
    return 'success'
  case 'error':
    return 'danger'
  case 'timeout':
    return 'warning'
  }
}
