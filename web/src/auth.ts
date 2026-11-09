import { createAuthClient } from '@neon/neon-js/auth'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL

export const authConfigured = Boolean(authUrl && !authUrl.includes('YOUR-'))
export const authClient = createAuthClient(authConfigured ? authUrl : 'https://auth.invalid')
