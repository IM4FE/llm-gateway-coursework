import type { ReactNode } from 'react'

import { Navigate, useLocation } from 'react-router-dom'

import { useAdminAuth } from '../../auth/useAdminAuth'

export interface RequireAdminProps {
  children: ReactNode
}

export function RequireAdmin({ children }: RequireAdminProps) {
  const { isAuthenticated } = useAdminAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`)

    return <Navigate replace to={`/login?redirect=${redirect}`} />
  }

  return <>{children}</>
}
