import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    strictPort: true,
    allowedHosts: [
      'duskiest-catastrophical-arnav.ngrok-free.dev'
    ]
  },
  build: {
    chunkSizeWarningLimit: 2000,
    target: 'esnext',
  }
  })
