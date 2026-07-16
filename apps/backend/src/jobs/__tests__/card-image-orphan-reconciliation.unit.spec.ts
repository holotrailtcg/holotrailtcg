import cardImageOrphanReconciliationJob from "../card-image-orphan-reconciliation"
import * as r2ConfigModule from "../../modules/trading-cards/images/r2-config"
import * as r2ClientModule from "../../modules/trading-cards/images/r2-client"
import * as cleanupConfigModule from "../../modules/trading-cards/images/cleanup-config"
import { MANAGED_FINAL_PREFIX, MANAGED_STAGING_PREFIX } from "../../modules/trading-cards/images/managed-prefixes"

jest.mock("../../modules/trading-cards/images/r2-config")
jest.mock("../../modules/trading-cards/images/r2-client")
jest.mock("../../modules/trading-cards/images/cleanup-config")

const resolveR2Config = r2ConfigModule.resolveR2Config as jest.Mock
const createR2ImageStorageClient = r2ClientModule.createR2ImageStorageClient as jest.Mock
const resolveCardImageCleanupDryRun = cleanupConfigModule.resolveCardImageCleanupDryRun as jest.Mock

const ZERO_COUNTS = { scanned: 0, retained: 0, wouldDelete: 0, deleted: 0, errors: 0, pagesProcessed: 0, limitReached: false }

function fakeContainer(reconcile: jest.Mock) {
  return { resolve: jest.fn().mockReturnValue({ reconcileOrphanedImageObjects: reconcile }) } as any
}

describe("cardImageOrphanReconciliationJob", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.DATABASE_URL = "postgres://user:pass@host/db"
    resolveR2Config.mockReturnValue({ enabled: true, bucketName: "fake-bucket" })
    createR2ImageStorageClient.mockReturnValue({ fake: "client" })
    resolveCardImageCleanupDryRun.mockReturnValue(true)
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
    logSpy.mockRestore()
  })

  it("is a clean no-op when R2 is not configured — the service is never resolved or called", async () => {
    resolveR2Config.mockReturnValue({ enabled: false })
    const reconcile = jest.fn()
    const container = fakeContainer(reconcile)

    await cardImageOrphanReconciliationJob(container)

    expect(reconcile).not.toHaveBeenCalled()
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it("is a clean no-op when DATABASE_URL is not configured", async () => {
    delete process.env.DATABASE_URL
    const reconcile = jest.fn()
    const container = fakeContainer(reconcile)

    await cardImageOrphanReconciliationJob(container)

    expect(reconcile).not.toHaveBeenCalled()
  })

  it("runs once for the staging prefix and once for the final prefix, passing the resolved dry-run flag through", async () => {
    resolveCardImageCleanupDryRun.mockReturnValue(false)
    const reconcile = jest.fn().mockResolvedValue(ZERO_COUNTS)
    const container = fakeContainer(reconcile)

    await cardImageOrphanReconciliationJob(container)

    expect(reconcile).toHaveBeenCalledTimes(2)
    const prefixesCalled = reconcile.mock.calls.map((call) => call[0].prefix)
    expect(prefixesCalled).toEqual(expect.arrayContaining([MANAGED_STAGING_PREFIX, MANAGED_FINAL_PREFIX]))
    for (const call of reconcile.mock.calls) {
      expect(call[0].dryRun).toBe(false)
      expect(call[0].databaseUrl).toBe(process.env.DATABASE_URL)
      expect(call[0].r2Client).toEqual({ fake: "client" })
    }
  })

  it("continues to the second prefix when the first prefix throws", async () => {
    const reconcile = jest.fn()
      .mockRejectedValueOnce(new Error("staging listObjects failed"))
      .mockResolvedValueOnce(ZERO_COUNTS)
    const container = fakeContainer(reconcile)

    await expect(cardImageOrphanReconciliationJob(container)).resolves.toBeUndefined()

    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it("logs only aggregate counts — never an object key, image id, variant id, URL, or credential", async () => {
    const secretLikeKey = "card-images/variant-abc123/image-def456/uuid-should-never-appear.jpg"
    const reconcile = jest.fn().mockResolvedValue({ ...ZERO_COUNTS, deleted: 3, scanned: 4 })
    const container = fakeContainer(reconcile)
    process.env.DATABASE_URL = `postgres://admin:supersecret@host/db?token=${secretLikeKey}`

    await cardImageOrphanReconciliationJob(container)

    const loggedLines = logSpy.mock.calls.map((call) => call.join(" "))
    for (const line of loggedLines) {
      expect(line).not.toContain(secretLikeKey)
      expect(line).not.toContain("supersecret")
    }
    expect(loggedLines.some((line) => line.includes("scanned=4") && line.includes("deleted=3"))).toBe(true)
  })
})
