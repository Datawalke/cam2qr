import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The demo runs against the BUILT library (pnpm demo builds first) so it
// exercises exactly what ships — including the dist worker entry.
export default defineConfig({
  root: resolve(import.meta.dirname, '.'),
  resolve: {
    alias: {
      cam2qr: resolve(import.meta.dirname, '../dist/index.js'),
    },
  },
  server: {
    port: 5183,
    host: true,
  },
});
