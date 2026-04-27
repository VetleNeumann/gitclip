import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8888',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', '../netlify/functions/test/**/*.test.ts'],
  },
});
