import { createContext } from 'react'

export interface AdminSession {
  token: string | null
  isAuthenticated: boolean
  signIn: (token: string) => void
  signOut: () => void
}

export const AdminAuthContext = createContext<AdminSession | null>(null)
