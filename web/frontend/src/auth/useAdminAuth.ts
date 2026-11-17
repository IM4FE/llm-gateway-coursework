import { useContext } from 'react'

import { AdminAuthContext } from './AdminAuthContext'

import type { AdminSession } from './AdminAuthContext'

export function useAdminAuth(): AdminSession {
  const session = useContext(AdminAuthContext)

  if (session === null) {
    throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  }

  return session
}
