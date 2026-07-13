// Jest global setup (referenced by `jest.config.js` -> `setupFiles`).
//
// Runs before every test suite. Loads the `test` environment and enforces the
// test-database safety guard so automated tests can never run against the
// development or production database.
const { loadEnv } = require("@medusajs/utils")

loadEnv("test", process.cwd())

const { assertTestDatabase } = require("../src/utils/assert-test-database")

const testType = process.env.TEST_TYPE

// Only the database-backed integration test types require a live database.
// Unit tests (`TEST_TYPE=unit`) never touch the database.
const requireDatabase =
  testType === "integration:http" || testType === "integration:modules"

assertTestDatabase(process.env.DATABASE_URL, { requireDatabase })
