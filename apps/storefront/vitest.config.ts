import { defineConfig } from "vitest/config"

/**
 * Storefront unit tests. Scope is intentionally small: pure helpers and content
 * configuration (validation, consent state, coming-soon copy). Component/DOM
 * rendering tests are out of scope for this stage (no jsdom/RTL added).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
})
