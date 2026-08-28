import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Blocks real (billed) Anthropic calls suite-wide. See the file's header.
    setupFiles: ['./vitest.setup.ts'],
    // apps/mobile is a workspace package with its OWN vitest config and its own
    // `pnpm --filter @phare/mobile test`. Without this line the default include
    // glob ('**/*.{test,spec}.?(c|m)[jt]s?(x)', which only excludes
    // node_modules) collects the Expo app's tests into the web suite — verified
    // before the app was created, with a throwaway apps/ probe that `vitest
    // list` picked up. They would then run in this config's `node` environment
    // against the web's `@` alias and change this suite's count. The two suites
    // are kept separate deliberately: this number is the web app's.
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});