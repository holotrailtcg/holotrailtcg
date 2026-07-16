import { acquirePrefixReconciliationLock } from "../images/orphan-reconciliation-lock"
import { MANAGED_FINAL_PREFIX, MANAGED_STAGING_PREFIX } from "../images/managed-prefixes"

const databaseUrl = process.env.DATABASE_URL as string

describe("acquirePrefixReconciliationLock", () => {
  it("a second concurrent attempt for the same prefix returns acquired: false immediately", async () => {
    const first = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    expect(first.acquired).toBe(true)

    const second = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    expect(second.acquired).toBe(false)

    await second.release()
    await first.release()
  })

  it("releasing the lock lets a later attempt succeed", async () => {
    const first = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    expect(first.acquired).toBe(true)
    await first.release()

    const second = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    expect(second.acquired).toBe(true)
    await second.release()
  })

  it("staging and final prefixes acquire independently and simultaneously", async () => {
    const staging = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    const final = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_FINAL_PREFIX)

    expect(staging.acquired).toBe(true)
    expect(final.acquired).toBe(true)

    await staging.release()
    await final.release()
  })

  it("release is idempotent and always safe to call, even when the lock was not acquired", async () => {
    const first = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    const second = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)

    await expect(second.release()).resolves.toBeUndefined()
    await expect(second.release()).resolves.toBeUndefined()

    await first.release()
    await expect(first.release()).resolves.toBeUndefined()
  })

  it("a lock left unreleased after a simulated failure still frees up once release() runs in finally", async () => {
    let secondAttemptAcquired: boolean | undefined
    try {
      const lease = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
      try {
        throw new Error("simulated failure mid-run")
      } finally {
        await lease.release()
      }
    } catch {
      // expected — this simulates a thrown error inside the caller's work
    }

    const retry = await acquirePrefixReconciliationLock(databaseUrl, MANAGED_STAGING_PREFIX)
    secondAttemptAcquired = retry.acquired
    await retry.release()

    expect(secondAttemptAcquired).toBe(true)
  })

  it("rejects a prefix that is not one of the two managed prefixes", async () => {
    await expect(acquirePrefixReconciliationLock(databaseUrl, "not-a-managed-prefix/")).rejects.toThrow()
  })
})
