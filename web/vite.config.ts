import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const ALLOWED_PUBLIC_ENV = new Set(['VITE_API_URL'])

export default defineConfig(({ mode }) => {
  const publicEnv = loadEnv(mode, '..', 'VITE_')
  const unexpected = Object.keys(publicEnv).filter(
    (key) => key.startsWith('VITE_') && !ALLOWED_PUBLIC_ENV.has(key),
  )
  if (unexpected.length > 0) {
    throw new Error(`Unexpected public frontend environment variables: ${unexpected.join(', ')}`)
  }

  return {
    root: '.',
    envDir: '..',
    plugins: [react()],
    server: { host: '0.0.0.0' },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('/@neon/') || id.includes('/better-auth/')) return 'auth-vendor'
            if (id.includes('/@tanstack/')) return 'query-vendor'
            if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react-vendor'
          },
        },
      },
    },
  }
})
