import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // MapLibre owns a Web Worker entrypoint that Vite's dev dependency optimizer can
  // invalidate during HMR, leaving an otherwise healthy map with no renderer.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: {
    // MapLibre alone routinely exceeds the default 500 kB minified warning threshold.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'maplibre',
              test: /node_modules[\\/]maplibre-gl(?:[\\/]|$)/,
            },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
