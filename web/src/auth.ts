import { createAuthClient } from '@neon/neon-js/auth'

export const authUrl = import.meta.env.VITE_NEON_AUTH_URL

export const authConfigured = Boolean(authUrl && !authUrl.includes('YOUR-'))
export const authClient = createAuthClient(authConfigured ? authUrl : 'https://auth.invalid')

export async function verifyEmailCode(email: string, otp: string) {
  const response = await fetch(`${authUrl}/email-otp/verify-email`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  })
  const result = await response.json().catch(() => null) as { message?: string } | null
  if (!response.ok) throw new Error(result?.message || 'No se pudo verificar el código.')
  return result
}
