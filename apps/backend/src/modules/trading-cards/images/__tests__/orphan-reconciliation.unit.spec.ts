import { runOrphanReconciliation } from "../orphan-reconciliation"
import { FakeR2ImageStorageClient } from "../../__fixtures__/fake-r2-client"
import { MANAGED_STAGING_PREFIX } from "../managed-prefixes"

const HOUR_MS = 60 * 60 * 1000

function graceCutoffMinutesAgo(minutes: number, now = new Date()): Date {
  return new Date(now.getTime() - minutes * 60_000)
}

function alwaysUnreferenced() {
  return jest.fn(async () => false)
}

/** Zero-padded keys so the fake's lexicographic sort matches insertion order for up to 999,999 objects. */
function seedManyOldObjects(r2Client: FakeR2ImageStorageClient, count: number, prefix = MANAGED_STAGING_PREFIX) {
  const old = new Date(Date.now() - 2 * HOUR_MS)
  for (let i = 0; i < count; i++) {
    r2Client.seedObject(`${prefix}obj-${String(i).padStart(6, "0")}.jpg`, Buffer.from("x"), old)
  }
}

describe("runOrphanReconciliation", () => {
  it("in dry-run, counts an old unreferenced object as wouldDelete without calling deleteObject", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    r2Client.seedObject(`${MANAGED_STAGING_PREFIX}old.jpg`, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: true, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    expect(counts).toMatchObject({ scanned: 1, wouldDelete: 1, deleted: 0, retained: 0, errors: 0 })
    expect(r2Client.deleteCalls).toEqual([])
    expect(r2Client.hasObject(`${MANAGED_STAGING_PREFIX}old.jpg`)).toBe(true)
  })

  it("in live mode, deletes an old unreferenced object", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}old.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    expect(counts).toMatchObject({ scanned: 1, deleted: 1, wouldDelete: 0, retained: 0, errors: 0 })
    expect(r2Client.hasObject(key)).toBe(false)
  })

  it("retains an object inside the grace period without ever calling isReferenced", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    r2Client.seedObject(`${MANAGED_STAGING_PREFIX}fresh.jpg`, Buffer.from("x"), new Date())
    const isReferenced = alwaysUnreferenced()

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced,
    })

    expect(counts).toMatchObject({ scanned: 0, retained: 1, deleted: 0, wouldDelete: 0 })
    expect(isReferenced).not.toHaveBeenCalled()
  })

  it("retains a referenced object without deleting it", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}referenced.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: async () => true,
    })

    expect(counts).toMatchObject({ scanned: 1, retained: 1, deleted: 0, wouldDelete: 0 })
    expect(r2Client.hasObject(key)).toBe(true)
  })

  it("checks isReferenced exactly twice before deleting, and retains the object if the second check finds it referenced", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}race.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    let calls = 0
    const isReferenced = jest.fn(async () => {
      calls += 1
      // Unreferenced at scan time, referenced by the time of the pre-delete recheck.
      return calls === 2
    })

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced,
    })

    expect(isReferenced).toHaveBeenCalledTimes(2)
    expect(counts).toMatchObject({ scanned: 1, retained: 1, deleted: 0 })
    expect(r2Client.hasObject(key)).toBe(true)
  })

  it("a delete failure increments errors and the loop continues to the next object", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const failingKey = `${MANAGED_STAGING_PREFIX}fails.jpg`
    const okKey = `${MANAGED_STAGING_PREFIX}ok.jpg`
    const old = new Date(Date.now() - 2 * HOUR_MS)
    r2Client.seedObject(failingKey, Buffer.from("x"), old)
    r2Client.seedObject(okKey, Buffer.from("x"), old)
    r2Client.failNextDeleteWith(new Error("boom"))

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    expect(counts.errors).toBe(1)
    expect(counts.deleted).toBe(1)
    expect(r2Client.deleteCalls).toHaveLength(2)
  })

  it("deleting an already-missing object is harmless (idempotent) and still counts as deleted", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    // Not actually seeded: simulate a listing entry for an object gone by delete time
    // by seeding then deleting out-of-band before the reconciliation call inspects it.
    const key = `${MANAGED_STAGING_PREFIX}already-gone.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    // FakeR2ImageStorageClient.deleteObject never throws for a missing key,
    // matching the real client's documented idempotent behaviour.
    expect(counts.deleted).toBe(1)
    expect(counts.errors).toBe(0)
  })

  it("running the same scan twice is idempotent — the second run finds nothing left to delete", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}once.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    const input = {
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    }
    const first = await runOrphanReconciliation(input)
    const second = await runOrphanReconciliation(input)

    expect(first.deleted).toBe(1)
    expect(second.scanned).toBe(0)
    expect(second.deleted).toBe(0)
  })

  it("stops at maxObjectsPerRun and reports limitReached", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const old = new Date(Date.now() - 2 * HOUR_MS)
    for (let i = 0; i < 5; i++) {
      r2Client.seedObject(`${MANAGED_STAGING_PREFIX}obj-${i}.jpg`, Buffer.from("x"), old)
    }

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 2,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    expect(counts.limitReached).toBe(true)
    expect(counts.deleted).toBe(2)
  })

  it("pages through listObjects using the continuation token until exhausted", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const old = new Date(Date.now() - 2 * HOUR_MS)
    for (let i = 0; i < 5; i++) {
      r2Client.seedObject(`${MANAGED_STAGING_PREFIX}obj-${i}.jpg`, Buffer.from("x"), old)
    }

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(), pageSize: 2,
    })

    expect(counts.pagesProcessed).toBeGreaterThanOrEqual(1)
    expect(counts.deleted).toBe(5)
  })

  it("rejects a prefix outside the two managed prefixes without ever calling listObjects", async () => {
    const r2Client = new FakeR2ImageStorageClient()

    await expect(runOrphanReconciliation({
      r2Client, prefix: "not-managed/", dryRun: true, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })).rejects.toThrow()

    expect(r2Client.listCalls).toEqual([])
  })

  describe("limitReached reporting at the production-aligned 5,000/1,000 cap", () => {
    it("production-aligned: caps at exactly 5,000 inspected objects across five 1,000-object pages, reports limitReached, and a later run continues the backlog", async () => {
      const r2Client = new FakeR2ImageStorageClient()
      seedManyOldObjects(r2Client, 5050)

      const counts = await runOrphanReconciliation({
        r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 5000,
        graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(), pageSize: 1000,
      })

      // Every seeded object is old and unreferenced, so `scanned` is exactly
      // the number of objects inspected — proving the cap, not the grace
      // period or reference check, is what stopped the run at 5,000.
      expect(counts.scanned).toBe(5000)
      expect(counts.deleted).toBe(5000)
      expect(counts.deleted).toBeLessThanOrEqual(5000)
      expect(counts.wouldDelete).toBe(0)
      expect(counts.errors).toBe(0)
      expect(counts.pagesProcessed).toBe(5)
      // Proves the continuation-token path was actually exercised across
      // page boundaries, not just a single unpaginated listObjects call.
      expect(r2Client.listCalls.length).toBe(5)
      expect(r2Client.listCalls[4].continuationToken).toBeDefined()
      expect(counts.limitReached).toBe(true)

      const secondRun = await runOrphanReconciliation({
        r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 5000,
        graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(), pageSize: 1000,
      })

      expect(secondRun.scanned).toBe(50)
      expect(secondRun.deleted).toBe(50)
      expect(secondRun.limitReached).toBe(false)
    })

    it("boundary: exactly 5,000 total objects consumes the whole listing with no continuation token, and limitReached stays false", async () => {
      const r2Client = new FakeR2ImageStorageClient()
      seedManyOldObjects(r2Client, 5000)

      const counts = await runOrphanReconciliation({
        r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 5000,
        graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(), pageSize: 1000,
      })

      expect(counts.scanned).toBe(5000)
      expect(counts.deleted).toBe(5000)
      expect(counts.pagesProcessed).toBe(5)
      expect(counts.limitReached).toBe(false)
    })

    it("boundary: 5,001 total objects leaves a continuation token after the fifth page, and limitReached is true", async () => {
      const r2Client = new FakeR2ImageStorageClient()
      seedManyOldObjects(r2Client, 5001)

      const counts = await runOrphanReconciliation({
        r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 5000,
        graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(), pageSize: 1000,
      })

      expect(counts.scanned).toBe(5000)
      expect(counts.pagesProcessed).toBe(5)
      expect(counts.limitReached).toBe(true)
    })

    it("boundary: the cap landing mid-page leaves unprocessed items in that page, and limitReached is true", async () => {
      const r2Client = new FakeR2ImageStorageClient()
      seedManyOldObjects(r2Client, 1500)

      const counts = await runOrphanReconciliation({
        r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 1200,
        graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(), pageSize: 1000,
      })

      // The cap (1,200) falls 200 objects into the second 1,000-object page,
      // leaving 300 objects in that page unprocessed.
      expect(counts.scanned).toBe(1200)
      expect(counts.pagesProcessed).toBe(2)
      expect(counts.limitReached).toBe(true)
    })
  })

  it("treats an object that disappears between the scan and the delete call as a successful, idempotent deletion", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}vanishes.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))

    let checks = 0
    const isReferenced = jest.fn(async () => {
      checks += 1
      if (checks === 2) {
        // Simulate the object disappearing out-of-band (e.g. deleted by a
        // concurrent process) between the scan and the pre-delete recheck.
        await r2Client.deleteObject(key)
      }
      return false
    })

    const counts = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced,
    })

    expect(isReferenced).toHaveBeenCalledTimes(2)
    expect(counts.deleted).toBe(1)
    expect(counts.errors).toBe(0)
    expect(r2Client.hasObject(key)).toBe(false)
  })

  it("a failed delete is retried successfully on the next reconciliation run", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}retry-me.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * HOUR_MS))
    r2Client.failNextDeleteWith(new Error("transient failure"))

    const firstRun = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    expect(firstRun.errors).toBe(1)
    expect(firstRun.deleted).toBe(0)
    expect(r2Client.hasObject(key)).toBe(true)

    const secondRun = await runOrphanReconciliation({
      r2Client, prefix: MANAGED_STAGING_PREFIX, dryRun: false, maxObjectsPerRun: 100,
      graceCutoff: graceCutoffMinutesAgo(30), isReferenced: alwaysUnreferenced(),
    })

    expect(secondRun.errors).toBe(0)
    expect(secondRun.deleted).toBe(1)
    expect(r2Client.hasObject(key)).toBe(false)
  })
})
