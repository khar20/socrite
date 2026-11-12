const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8000/api/v1' : '/api/v1')

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  if (response.status === 204) return undefined as T
  const result = await response.json().catch(() => null) as { detail?: unknown } | null
  if (!response.ok) {
    const message = typeof result?.detail === 'string' ? result.detail : 'No se pudo completar la solicitud.'
    throw new ApiError(response.status, message)
  }
  return result as T
}

export const jsonBody = (value: unknown) => JSON.stringify(value)
