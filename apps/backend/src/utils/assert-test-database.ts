/**
 * Test-database safety guard.
 *
 * Automated tests must never run against the development or production database.
 * These helpers inspect the configured `DATABASE_URL` and refuse to proceed
 * unless the database name clearly identifies itself as a test database (its
 * name must contain the word "test", e.g. `holotrail_medusa_test`).
 *
 * The guard is wired into Jest via `integration-tests/setup.js`, which runs
 * before every test suite. It is kept as a set of small pure functions so the
 * behaviour can be unit tested without a database connection.
 *
 * Error messages deliberately never include the full connection string, so
 * credentials embedded in `DATABASE_URL` are not leaked into test output.
 */

export class NonTestDatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NonTestDatabaseError"
  }
}

/**
 * Extract the database name from a PostgreSQL connection string.
 * e.g. `postgres://user:pw@host:5432/holotrail_medusa_test?sslmode=require`
 * returns `holotrail_medusa_test`.
 */
export function extractDatabaseName(databaseUrl: string): string | undefined {
  const withoutQuery = databaseUrl.split("?")[0]
  const lastSegment = withoutQuery.split("/").pop()
  const dbName = lastSegment?.trim()
  return dbName ? dbName : undefined
}

/** A database name is considered a test database when it contains "test". */
export function isTestDatabaseName(databaseName: string): boolean {
  return /test/i.test(databaseName)
}

export interface AssertTestDatabaseOptions {
  /**
   * When true, a `DATABASE_URL` must be present (used for database-backed
   * integration test suites). Unit tests do not touch the database, so they
   * pass this as false.
   */
  requireDatabase: boolean
}

/**
 * Throw a `NonTestDatabaseError` unless it is safe to run automated tests
 * against the configured database.
 */
export function assertTestDatabase(
  databaseUrl: string | undefined,
  options: AssertTestDatabaseOptions
): void {
  if (!databaseUrl) {
    if (options.requireDatabase) {
      throw new NonTestDatabaseError(
        "Refusing to run database-backed tests: DATABASE_URL is not set. " +
          "Point it at a dedicated test database whose name contains 'test' " +
          "(for example holotrail_medusa_test)."
      )
    }
    // Unit tests do not need a database; nothing configured, nothing to guard.
    return
  }

  const databaseName = extractDatabaseName(databaseUrl)
  if (!databaseName || !isTestDatabaseName(databaseName)) {
    throw new NonTestDatabaseError(
      `Refusing to run tests against database "${databaseName ?? "<unknown>"}": ` +
        "the configured DATABASE_URL does not clearly identify a test database. " +
        "The database name must contain 'test' (for example holotrail_medusa_test)."
    )
  }
}
