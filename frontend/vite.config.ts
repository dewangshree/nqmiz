import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the API is proxied so the browser talks to a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly: Node may otherwise listen only on ::1, making 127.0.0.1:5173 unreachable.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
