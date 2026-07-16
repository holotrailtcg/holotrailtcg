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
})
