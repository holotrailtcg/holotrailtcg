import path from "node:path"

import { defineConfig } from "vitest/config"

/**
 * Storefront unit tests. Scope is intentionally small: pure helpers, content
 * configuration (validation, consent state, coming-soon copy) and server-side
 * string rendering of page composition (no jsdom/RTL — DOM interaction tests
 * are still out of scope for this stage). The aliases below mirror
 * `tsconfig.json`'s `paths` so composition tests can import the real
 * page/view modules the same way application code does.
 */
export default defineConfig({
  esbuild: {
    // The app's own tsconfig sets `jsx: "preserve"` for Next's compiler; esbuild
    // needs an explicit runtime, so tests use the same automatic runtime Next
    // uses (no manual `React` import required in the rendered .tsx sources).
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@content": path.resolve(__dirname, "src/content"),
      "@components": path.resolve(__dirname, "src/components"),
      "@lib": path.resolve(__dirname, "src/lib"),
    },
  },
})
