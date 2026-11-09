import { authClient } from './auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

async function accessToken(): Promise<string | null> {
  const response = await authClient.getSession()
  const data = response.data as { session?: { access_token?: string; token?: string } } | null
  const sessionToken = data?.session?.access_token ?? data?.session?.token
  if (sessionToken) return sessionToken
  const client = authClient as typeof authClient & {
    getJWTToken?: () => Promise<string | null>
    token?: () => Promise<{ data?: { token?: string } | null }>
  }
  if (client.getJWTToken) return client.getJWTToken()
  if (client.token) return (await client.token()).data?.token ?? null
  return null
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (response.status === 204) return undefined as T
  const result = await response.json().catch(() => null) as { detail?: unknown } | null
  if (!response.ok) {
    const message = typeof result?.detail === 'string' ? result.detail : 'No se pudo completar la solicitud.'
    throw new ApiError(response.status, message)
  }
  return result as T
}

export const jsonBody = (value: unknown) => JSON.stringify(value)
