import { visibleReviewActions } from "../review-actions"
import type { ReviewStatus } from "../types"

describe("visibleReviewActions", () => {
  it("offers approve, reject and retry while pending", () => {
    expect(visibleReviewActions("PENDING")).toEqual({ approve: true, reject: true, apply: false, retry: true })
  })

  it("offers only apply and retry once approved", () => {
    expect(visibleReviewActions("APPROVED")).toEqual({ approve: false, reject: false, apply: true, retry: true })
  })

  it("offers only retry once rejected", () => {
    expect(visibleReviewActions("REJECTED")).toEqual({ approve: false, reject: false, apply: false, retry: true })
  })

  it("offers only retry once applied", () => {
    expect(visibleReviewActions("APPLIED")).toEqual({ approve: false, reject: false, apply: false, retry: true })
  })

  it("offers no mutation actions once superseded", () => {
    expect(visibleReviewActions("SUPERSEDED")).toEqual({ approve: false, reject: false, apply: false, retry: false })
  })

  it("never offers an action outside the five known statuses", () => {
    const statuses: ReviewStatus[] = ["PENDING", "APPROVED", "REJECTED", "APPLIED", "SUPERSEDED"]
    for (const status of statuses) {
      const actions = visibleReviewActions(status)
      expect(Object.values(actions).every((value) => typeof value === "boolean")).toBe(true)
    }
  })
})
