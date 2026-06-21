import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // `vite preview` serves the production build on Railway. Allow the
  // platform-assigned host and bind to the injected $PORT.
  preview: {
    host: true,
    allowedHosts: true,
    port: Number(process.env.PORT) || 4173,
  },
})
