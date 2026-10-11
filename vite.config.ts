import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  server: { port: 5199 },
  test: { environment: 'node' },
} as any);
