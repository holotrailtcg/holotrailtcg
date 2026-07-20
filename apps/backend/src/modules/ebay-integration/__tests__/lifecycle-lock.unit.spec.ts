import { Modules } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "../index"
import { withEbayLifecycleLock } from "../lifecycle-lock"

describe("eBay lifecycle lock failures", () => {
  it("audits an acquisition timeout and returns only a safe correlation reference", async () => {
    const recordLifecycleLockFailure = jest.fn(async () => undefined)
    const container = {
      resolve: (key: string) => {
        if (key === Modules.LOCKING) return {
          execute: async () => { throw new Error("Timed-out acquiring lock: provider-detail-sentinel") },
        }
        if (key === EBAY_INTEGRATION_MODULE) return { recordLifecycleLockFailure }
        throw new Error("unexpected dependency")
      },
    }
    let error: Error | undefined
    try {
      await withEbayLifecycleLock({
        container: container as never, environment: "SANDBOX", actorId: "actor-1",
        correlationId: "safe-correlation", work: async () => "unused",
      })
    } catch (caught) {
      error = caught as Error
    }

    expect(error?.message).toContain("safe-correlation")
    expect(error?.message).not.toContain("provider-detail-sentinel")
    expect(recordLifecycleLockFailure).toHaveBeenCalledWith(expect.objectContaining({
      environment: "SANDBOX", actorId: "actor-1", correlationId: "safe-correlation",
    }))
  })
})
