import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The API (server/) listens on 3001 by default; override with API_TARGET (e.g. http://localhost:3101).
const target = process.env.API_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  // Emscripten output fetches its .wasm file; make sure Vite treats it as an asset.
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/health': target,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
