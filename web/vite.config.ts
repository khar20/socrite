import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
})
