import { useCallback, useEffect, useState } from 'react'

import { describeApiError, fetchRequestLogs } from '../lib/api'

import type { RequestLog } from '../data/types'

export interface RequestLogsState {
  requests: RequestLog[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useRequestLogs(): RequestLogsState {
  const [requests, setRequests] = useState<RequestLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => {
    setVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)

    void fetchRequestLogs()
      .then((items) => {
        if (!cancelled) {
          setRequests(items)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(describeApiError(caught))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [version])

  return { requests, loading, error, reload }
}
