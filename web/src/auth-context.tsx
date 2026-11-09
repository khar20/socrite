import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { authClient } from './auth'
import { api } from './api'
import type { Profile } from './types'

type AuthState = {
  profile: Profile | null
  loading: boolean
  error: string | null
  refresh: () => Promise<Profile | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const result = await authClient.getSession()
      const sessionData = result.data as { session?: unknown } | null
      if (!sessionData?.session) {
        setProfile(null)
        return null
      }
      const current = await api<Profile>('/me')
      setProfile(current)
      return current
    } catch (reason) {
      setProfile(null)
      const message = reason instanceof Error ? reason.message : 'No se pudo verificar la sesión.'
      setError(message)
      throw reason
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh().catch(() => {}) }, [refresh])

  const signOut = useCallback(async () => {
    await authClient.signOut()
    setProfile(null)
    setError(null)
  }, [])

  return <AuthContext.Provider value={{ profile, loading, error, refresh, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
