import { defineConfig } from 'vitest/config';
import path from 'path';

// ---------------------------------------------------------------------------
// The Expo app's OWN test suite, deliberately separate from the repo root's.
//
// The root vitest.config.ts excludes `apps/**` (see the comment there). Two
// reasons this is a second config rather than one shared suite:
//
//   1. The root suite's count is the WEB app's number. Folding mobile tests
//      into it would make "1797 passed" mean something different from one week
//      to the next, and the whole point of quoting that number is that it does
//      not move when unrelated work lands.
//   2. The root config aliases `@` to the web app's src/. This one aliases it
//      to apps/mobile/src/. They cannot both be true in one config.
//
// What runs here is pure logic only — message-catalogue parity, the i18n
// lookup/interpolation functions, and the API error mapping. Nothing here
// renders a React Native component: that needs a device or a native test
// renderer, and neither belongs in a scaffold. See README.md.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
