import { defineConfig } from 'vitest/config';

// Separate config: the comparative benchmark is slow (three decoders across
// distortion sweeps) and writes docs/benchmarks.md — run via `pnpm compare`,
// never as part of `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/compare/compare.ts'],
    environment: 'node',
    testTimeout: 300_000,
  },
});
