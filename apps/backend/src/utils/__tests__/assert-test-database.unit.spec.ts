import {
  assertTestDatabase,
  extractDatabaseName,
  isTestDatabaseName,
  NonTestDatabaseError,
} from "../assert-test-database"

describe("extractDatabaseName", () => {
  it("extracts the database name from a full connection string", () => {
    expect(
      extractDatabaseName("postgres://user:pw@host:5432/holotrail_medusa_test")
    ).toBe("holotrail_medusa_test")
  })

  it("ignores query parameters (e.g. sslmode)", () => {
    expect(
      extractDatabaseName(
        "postgres://user:pw@host/holotrail_medusa_test?sslmode=require"
      )
    ).toBe("holotrail_medusa_test")
  })

  it("returns undefined when there is no database segment", () => {
    expect(extractDatabaseName("postgres://user:pw@host:5432/")).toBeUndefined()
  })
})

describe("isTestDatabaseName", () => {
  it("accepts names containing 'test' (any case)", () => {
    expect(isTestDatabaseName("holotrail_medusa_test")).toBe(true)
    expect(isTestDatabaseName("Holotrail_TEST")).toBe(true)
  })

  it("rejects names that do not contain 'test'", () => {
    expect(isTestDatabaseName("holotrail_medusa_dev")).toBe(false)
    expect(isTestDatabaseName("production")).toBe(false)
  })
})

describe("assertTestDatabase", () => {
  it("passes for a database whose name contains 'test'", () => {
    expect(() =>
      assertTestDatabase("postgres://u:p@h/holotrail_medusa_test", {
        requireDatabase: true,
      })
    ).not.toThrow()
  })

  it("throws for a non-test database", () => {
    expect(() =>
      assertTestDatabase("postgres://u:p@h/holotrail_medusa_dev", {
        requireDatabase: true,
      })
    ).toThrow(NonTestDatabaseError)
  })

  it("throws when a database is required but DATABASE_URL is missing", () => {
    expect(() =>
      assertTestDatabase(undefined, { requireDatabase: true })
    ).toThrow(NonTestDatabaseError)
  })

  it("passes when no database is required and none is configured (unit tests)", () => {
    expect(() =>
      assertTestDatabase(undefined, { requireDatabase: false })
    ).not.toThrow()
  })

  it("still rejects a non-test database even when a database is not required", () => {
    expect(() =>
      assertTestDatabase("postgres://u:p@h/holotrail_medusa_dev", {
        requireDatabase: false,
      })
    ).toThrow(NonTestDatabaseError)
  })

  it("does not leak credentials from the connection string in the error", () => {
    expect.assertions(2)
    try {
      assertTestDatabase("postgres://secretuser:secretpw@host/prod_db", {
        requireDatabase: true,
      })
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain("secretpw")
      expect(message).not.toContain("secretuser")
    }
  })
})
