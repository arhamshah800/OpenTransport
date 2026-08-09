import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // MapLibre owns a Web Worker entrypoint that Vite's dev dependency optimizer can
  // invalidate during HMR, leaving an otherwise healthy map with no renderer.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
