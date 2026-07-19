import {
  INVENTORY_HOLDING_STATUS, INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_SNAPSHOT_STATUS,
  isValidInventoryHoldingTransition, isValidInventoryProposalTransition, isValidInventorySnapshotTransition,
} from "../types"

describe("inventory snapshot lifecycle transitions", () => {
  it("allows the full happy path", () => {
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.VALIDATED)).toBe(true)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.VALIDATED, INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW)).toBe(true)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, INVENTORY_SNAPSHOT_STATUS.APPROVED)).toBe(true)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.APPROVED, INVENTORY_SNAPSHOT_STATUS.APPLYING)).toBe(true)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.APPLYING, INVENTORY_SNAPSHOT_STATUS.APPLIED)).toBe(true)
  })

  it("allows rejection only from pending review", () => {
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, INVENTORY_SNAPSHOT_STATUS.REJECTED)).toBe(true)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.REJECTED)).toBe(false)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.APPROVED, INVENTORY_SNAPSHOT_STATUS.REJECTED)).toBe(false)
  })

  it("rejects skipping states", () => {
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.APPROVED)).toBe(false)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.APPLIED)).toBe(false)
  })

  it("treats SUPERSEDED and DISCARDED as having no further transitions", () => {
    for (const terminal of [INVENTORY_SNAPSHOT_STATUS.SUPERSEDED, INVENTORY_SNAPSHOT_STATUS.DISCARDED]) {
      for (const target of Object.values(INVENTORY_SNAPSHOT_STATUS)) {
        expect(isValidInventorySnapshotTransition(terminal, target)).toBe(false)
      }
    }
  })

  it("allows discarding a REJECTED or FAILED snapshot (an Admin manually clearing it), but nothing else", () => {
    for (const terminal of [INVENTORY_SNAPSHOT_STATUS.REJECTED, INVENTORY_SNAPSHOT_STATUS.FAILED]) {
      for (const target of Object.values(INVENTORY_SNAPSHOT_STATUS)) {
        const expected = target === INVENTORY_SNAPSHOT_STATUS.DISCARDED
        expect(isValidInventorySnapshotTransition(terminal, target)).toBe(expected)
      }
    }
  })

  it("allows discarding a not-yet-applied snapshot (DRAFT/VALIDATED/PENDING_REVIEW/APPROVED), but never an APPLYING or APPLIED one", () => {
    for (const preApplication of [
      INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.VALIDATED,
      INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, INVENTORY_SNAPSHOT_STATUS.APPROVED,
    ]) {
      expect(isValidInventorySnapshotTransition(preApplication, INVENTORY_SNAPSHOT_STATUS.DISCARDED)).toBe(true)
    }
    for (const stockTouched of [INVENTORY_SNAPSHOT_STATUS.APPLYING, INVENTORY_SNAPSHOT_STATUS.APPLIED]) {
      expect(isValidInventorySnapshotTransition(stockTouched, INVENTORY_SNAPSHOT_STATUS.DISCARDED)).toBe(false)
    }
  })

  it("allows superseding an approved or applied snapshot when a newer one is approved/applied", () => {
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.APPROVED, INVENTORY_SNAPSHOT_STATUS.SUPERSEDED)).toBe(true)
    expect(isValidInventorySnapshotTransition(INVENTORY_SNAPSHOT_STATUS.APPLIED, INVENTORY_SNAPSHOT_STATUS.SUPERSEDED)).toBe(true)
  })
})

describe("inventory holding status transitions", () => {
  it("allows draft to ready, ready to archived, and archived back to ready", () => {
    expect(isValidInventoryHoldingTransition(INVENTORY_HOLDING_STATUS.DRAFT, INVENTORY_HOLDING_STATUS.READY)).toBe(true)
    expect(isValidInventoryHoldingTransition(INVENTORY_HOLDING_STATUS.READY, INVENTORY_HOLDING_STATUS.ARCHIVED)).toBe(true)
    expect(isValidInventoryHoldingTransition(INVENTORY_HOLDING_STATUS.ARCHIVED, INVENTORY_HOLDING_STATUS.READY)).toBe(true)
  })

  it("allows abandoning a draft directly to archived", () => {
    expect(isValidInventoryHoldingTransition(INVENTORY_HOLDING_STATUS.DRAFT, INVENTORY_HOLDING_STATUS.ARCHIVED)).toBe(true)
  })

  it("rejects archived moving directly to draft", () => {
    expect(isValidInventoryHoldingTransition(INVENTORY_HOLDING_STATUS.ARCHIVED, INVENTORY_HOLDING_STATUS.DRAFT)).toBe(false)
  })
})

describe("inventory proposal review-status transitions", () => {
  it("allows pending to approved or rejected, and approved to applied", () => {
    expect(isValidInventoryProposalTransition(INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING, INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED)).toBe(true)
    expect(isValidInventoryProposalTransition(INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING, INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED)).toBe(true)
    expect(isValidInventoryProposalTransition(INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED, INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED)).toBe(true)
  })

  it("rejects applying a proposal that has not been approved", () => {
    expect(isValidInventoryProposalTransition(INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING, INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED)).toBe(false)
  })

  it("treats rejected and applied as terminal", () => {
    for (const terminal of [INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED, INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED]) {
      for (const target of Object.values(INVENTORY_PROPOSAL_REVIEW_STATUS)) {
        expect(isValidInventoryProposalTransition(terminal, target)).toBe(false)
      }
    }
  })
})
