import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  base: '/mLRS-Flasher/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'stream', 'events', 'util', 'process', 'timers'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000,
  },
})
