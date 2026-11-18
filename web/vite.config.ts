import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The API (server/) listens on 3001; the dev proxy keeps the browser same-origin.
export default defineConfig({
  plugins: [react()],
  // Emscripten output fetches its .wasm file; make sure Vite treats it as an asset.
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
