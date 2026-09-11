import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The dashboard's components are JSX. The automatic runtime means they never
  // need a React import, in tests or in the app.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/test/**/*.test.js', 'apps/*/test/**/*.test.jsx'],
    environment: 'node',

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      /*
       * `core` is the test surface: pure functions, no I/O, no network, and the
       * place a wrong number originates. Coverage is measured and enforced here
       * and nowhere else — a threshold over the proxy or the dashboard would
       * push us toward testing wiring instead of arithmetic.
       */
      include: ['packages/core/src/**/*.js'],
      // Generated data, not logic.
      exclude: ['packages/core/src/pricing/snapshot.js'],
      thresholds: {
        statements: 98,
        lines: 98,
        functions: 98,
        branches: 80,
      },
    },
  },
})
