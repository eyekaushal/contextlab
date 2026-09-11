import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The dashboard's components are JSX. The automatic runtime means they never
  // need a React import, in tests or in the app.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/test/**/*.test.js', 'apps/*/test/**/*.test.jsx'],
    environment: 'node',
  },
})
