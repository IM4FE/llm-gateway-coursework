import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { AdminAuthContext } from './AdminAuthContext'

import type { AdminSession } from './AdminAuthContext'

const STORAGE_KEY = 'llm-gateway-admin-token'

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function persistToken(token: string | null): void {
  try {
    if (token === null) {
      sessionStorage.removeItem(STORAGE_KEY)

      return
    }

    sessionStorage.setItem(STORAGE_KEY, token)
  } catch {
    // sessionStorage может быть недоступен в приватном режиме.
  }
}

export interface AdminAuthProviderProps {
  children: ReactNode
}

export function AdminAuthProvider({ children }: AdminAuthProviderProps) {
  const [token, setToken] = useState<string | null>(readStoredToken)

  const session = useMemo<AdminSession>(
    () => ({
      token,
      isAuthenticated: token !== null && token.trim() !== '',
      signIn: (nextToken: string) => {
        const normalized = nextToken.trim()

        if (normalized === '') {
          return
        }

        persistToken(normalized)
        setToken(normalized)
      },
      signOut: () => {
        persistToken(null)
        setToken(null)
      },
    }),
    [token],
  )

  return (
    <AdminAuthContext.Provider value={session}>
      {children}
    </AdminAuthContext.Provider>
  )
}
