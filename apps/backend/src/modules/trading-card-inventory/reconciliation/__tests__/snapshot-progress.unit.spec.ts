import { computeInventorySnapshotProgress, type SnapshotProgressProposalRow } from "../snapshot-progress"

const proposal = (overrides: Partial<SnapshotProgressProposalRow> = {}): SnapshotProgressProposalRow => ({
  id: "tciprop_1",
  reviewStatus: "PENDING",
  medusaSyncStatus: "NOT_APPLICABLE",
  changeKind: "QUANTITY_CHANGE",
  tradingCardVariantId: "tcvar_1",
  previousQuantity: 5,
  ...overrides,
})

describe("computeInventorySnapshotProgress", () => {
  it("all pending: not reviewed, not applicable-applied, not complete", () => {
    const progress = computeInventorySnapshotProgress(
      [proposal({ reviewStatus: "PENDING" }), proposal({ reviewStatus: "PENDING" })],
      new Map(),
    )
    expect(progress).toMatchObject({ pending: 2, allReviewed: false, allApplicableApplied: false, fullyComplete: false })
  })

  it("mixture of pending, approved and rejected: allReviewed stays false", () => {
    const progress = computeInventorySnapshotProgress(
      [
        proposal({ id: "p1", reviewStatus: "PENDING" }),
        proposal({ id: "p2", reviewStatus: "APPROVED" }),
        proposal({ id: "p3", reviewStatus: "REJECTED" }),
      ],
      new Map([["tcvar_1", 5]]),
    )
    expect(progress.pending).toBe(1)
    expect(progress.approved).toBe(1)
    expect(progress.rejected).toBe(1)
    expect(progress.allReviewed).toBe(false)
  })

  it("all reviewed but approved proposals remain unapplied", () => {
    const progress = computeInventorySnapshotProgress(
      [proposal({ reviewStatus: "APPROVED" }), proposal({ id: "p2", reviewStatus: "REJECTED" })],
      new Map([["tcvar_1", 5]]),
    )
    expect(progress.allReviewed).toBe(true)
    expect(progress.allApplicableApplied).toBe(false)
    expect(progress.fullyComplete).toBe(false)
  })

  it("all approved proposals locally applied but Medusa sync pending: not fully complete", () => {
    const progress = computeInventorySnapshotProgress(
      [proposal({ reviewStatus: "APPLIED", medusaSyncStatus: "PENDING" })],
      new Map(),
    )
    expect(progress.appliedSyncPending).toBe(1)
    expect(progress.allApplicableApplied).toBe(true)
    expect(progress.fullyComplete).toBe(false)
  })

  it("one or more proposals with FAILED Medusa sync: not fully complete", () => {
    const progress = computeInventorySnapshotProgress(
      [
        proposal({ id: "p1", reviewStatus: "APPLIED", medusaSyncStatus: "SYNCED" }),
        proposal({ id: "p2", reviewStatus: "APPLIED", medusaSyncStatus: "FAILED" }),
      ],
      new Map(),
    )
    expect(progress.appliedFullySynced).toBe(1)
    expect(progress.appliedSyncFailed).toBe(1)
    expect(progress.fullyComplete).toBe(false)
  })

  it("all applicable proposals applied and synced: fully complete", () => {
    const progress = computeInventorySnapshotProgress(
      [
        proposal({ id: "p1", reviewStatus: "APPLIED", medusaSyncStatus: "SYNCED" }),
        proposal({ id: "p2", reviewStatus: "REJECTED" }),
      ],
      new Map(),
    )
    expect(progress.allReviewed).toBe(true)
    expect(progress.allApplicableApplied).toBe(true)
    expect(progress.fullyComplete).toBe(true)
  })

  it("stale/blocked approved proposal (live holding quantity has drifted): never fully complete", () => {
    const progress = computeInventorySnapshotProgress(
      [proposal({ reviewStatus: "APPROVED", previousQuantity: 5 })],
      new Map([["tcvar_1", 9]]),
    )
    expect(progress.blocked).toBe(1)
    expect(progress.approved).toBe(0)
    expect(progress.allApplicableApplied).toBe(false)
    expect(progress.fullyComplete).toBe(false)
  })

  it("treats a missing holding as live quantity zero for baseline comparison", () => {
    const matching = computeInventorySnapshotProgress(
      [proposal({ reviewStatus: "APPROVED", changeKind: "NEW_HOLDING", previousQuantity: 0 })],
      new Map(),
    )
    expect(matching.approved).toBe(1)
    expect(matching.blocked).toBe(0)

    const drifted = computeInventorySnapshotProgress(
      [proposal({ reviewStatus: "APPROVED", changeKind: "NEW_HOLDING", previousQuantity: 0, tradingCardVariantId: "tcvar_2" })],
      new Map([["tcvar_2", 3]]),
    )
    expect(drifted.approved).toBe(0)
    expect(drifted.blocked).toBe(1)
  })

  it("an approved UNRESOLVED_VARIANT proposal (null variant id) is out of scope, not blocked, and never gates completion", () => {
    const progress = computeInventorySnapshotProgress(
      [
        proposal({ reviewStatus: "APPROVED", changeKind: "UNRESOLVED_VARIANT", tradingCardVariantId: null, previousQuantity: null }),
        proposal({ id: "p2", reviewStatus: "APPLIED", medusaSyncStatus: "SYNCED" }),
      ],
      new Map(),
    )
    expect(progress.outOfScope).toBe(1)
    expect(progress.blocked).toBe(0)
    expect(progress.allApplicableApplied).toBe(true)
    expect(progress.fullyComplete).toBe(true)
  })

  it("approved PRICE_CHANGE/COST_CHANGE/NO_CHANGE proposals are out of scope and never gate completion", () => {
    for (const changeKind of ["PRICE_CHANGE", "COST_CHANGE", "NO_CHANGE"] as const) {
      const progress = computeInventorySnapshotProgress([proposal({ reviewStatus: "APPROVED", changeKind })], new Map([["tcvar_1", 5]]))
      expect(progress.outOfScope).toBe(1)
      expect(progress.approved).toBe(0)
      expect(progress.blocked).toBe(0)
      expect(progress.fullyComplete).toBe(true)
    }
  })

  it("an empty proposal set is vacuously fully complete", () => {
    const progress = computeInventorySnapshotProgress([], new Map())
    expect(progress).toMatchObject({ totalProposals: 0, allReviewed: true, allApplicableApplied: true, fullyComplete: true })
  })
})
