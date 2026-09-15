import { defineConfig } from 'vitest/config';

// ---------------------------------------------------------------------------
// The compiled-bundle compliance scan, and nothing else.
//
// Separate from vitest.config.ts so `pnpm test` never runs it: it needs a
// freshly exported bundle in dist/, which `bundle:check` produces first. See
// src/__tests__/bundleCompliance.bundle.ts.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/bundleCompliance.bundle.ts'],
  },
});
