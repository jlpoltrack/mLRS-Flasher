import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/mLRS-Flasher/',

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
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-esptool': ['esptool-js'],
          'vendor-mavlink': ['node-mavlink'],
          'vendor-dfu': ['webdfu', 'dfu'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
})
