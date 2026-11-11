import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api } from './api'
import type { User } from './types'

type AuthState = {
  profile: User | null
  loading: boolean
  error: string | null
  refresh: () => Promise<User | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const current = await api<User>('/auth/me')
      setProfile(current)
      return current
    } catch (reason) {
      setProfile(null)
      if (reason instanceof ApiError && reason.status === 401) return null
      const message = reason instanceof Error ? reason.message : 'No se pudo verificar la sesión.'
      setError(message)
      throw reason
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh().catch(() => {}) }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' })
    } finally {
      setProfile(null)
      setError(null)
    }
  }, [])

  return <AuthContext.Provider value={{ profile, loading, error, refresh, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
