import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  base: '/mLRS-Flasher/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'stream', 'events', 'util', 'process'],
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
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('node-mavlink') || id.includes('mavlink-mappings') || id.includes('xml2js')) {
              return 'mavlink';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('lucide-react')) {
              return 'react-vendor';
            }
            if (id.includes('vite-plugin-node-polyfills') || id.includes('node-stdlib-browser')) {
              return 'polyfills';
            }
            return 'vendor';
          }
        },
      },
    },
  },
})
