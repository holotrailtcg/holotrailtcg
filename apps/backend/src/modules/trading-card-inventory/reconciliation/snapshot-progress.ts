import {
  INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROPOSAL_REVIEW_STATUS, MEDUSA_SYNC_STATUS,
  type InventoryProposalChangeKind, type InventoryProposalReviewStatus, type MedusaSyncStatus,
} from "../types"

export interface SnapshotProgressProposalRow {
  id: string
  reviewStatus: InventoryProposalReviewStatus
  medusaSyncStatus: MedusaSyncStatus
  changeKind: InventoryProposalChangeKind
  tradingCardVariantId: string | null
  previousQuantity: number | null
}

export interface SnapshotProgress {
  totalProposals: number
  pending: number
  approved: number
  rejected: number
  appliedFullySynced: number
  appliedSyncPending: number
  appliedSyncFailed: number
  /** Approved, in-scope (NEW_HOLDING/QUANTITY_CHANGE) proposals whose baseline has drifted since reconciliation — never auto-fixed here; require re-reconciliation. */
  blocked: number
  /**
   * Approved proposals this stage never applies at all: PRICE_CHANGE/COST_CHANGE
   * (pricing writes are out of Stage 5B.2's scope per CLAUDE.md), NO_CHANGE
   * (nothing to move), and UNRESOLVED_VARIANT (no variant to apply against
   * yet). Tracked separately from `blocked` so an out-of-scope proposal can
   * never permanently prevent a snapshot from being reported/transitioned as
   * fully complete.
   */
  outOfScope: number
  allReviewed: boolean
  allApplicableApplied: boolean
  fullyComplete: boolean
}

const IN_SCOPE_CHANGE_KINDS: ReadonlySet<InventoryProposalChangeKind> = new Set([
  INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING,
  INVENTORY_PROPOSAL_CHANGE_KIND.QUANTITY_CHANGE,
])

/**
 * Deterministic, pure aggregation of a snapshot's proposal rows into a
 * progress summary — the single source of truth for whether a snapshot may
 * be reported or transitioned as fully applied. Never trust client input for
 * any of this; always recompute from current proposal (and, for staleness,
 * holding) state.
 *
 * `holdingQuantityByVariantId` supplies the *live* holding quantity for each
 * proposal's `tradingCardVariantId`, used to detect baseline drift for
 * approved-but-unapplied proposals without requiring anyone to have actually
 * attempted (and failed) an apply first — a proposal is "blocked" the moment
 * its expected baseline no longer matches reality, not only after a failed
 * apply call surfaces that fact.
 */
export function computeInventorySnapshotProgress(
  proposals: SnapshotProgressProposalRow[],
  holdingQuantityByVariantId: ReadonlyMap<string, number>,
): SnapshotProgress {
  const progress: SnapshotProgress = {
    totalProposals: proposals.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    appliedFullySynced: 0,
    appliedSyncPending: 0,
    appliedSyncFailed: 0,
    blocked: 0,
    outOfScope: 0,
    allReviewed: false,
    allApplicableApplied: false,
    fullyComplete: false,
  }

  for (const proposal of proposals) {
    switch (proposal.reviewStatus) {
      case INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING: {
        progress.pending += 1
        break
      }
      case INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED: {
        progress.rejected += 1
        break
      }
      case INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED: {
        if (proposal.medusaSyncStatus === MEDUSA_SYNC_STATUS.SYNCED) progress.appliedFullySynced += 1
        else if (proposal.medusaSyncStatus === MEDUSA_SYNC_STATUS.FAILED) progress.appliedSyncFailed += 1
        else progress.appliedSyncPending += 1
        break
      }
      case INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED: {
        if (!IN_SCOPE_CHANGE_KINDS.has(proposal.changeKind)) {
          progress.outOfScope += 1
          break
        }
        const liveQuantity = proposal.tradingCardVariantId !== null
          ? holdingQuantityByVariantId.get(proposal.tradingCardVariantId) ?? 0
          : null
        const expectedBaseline = proposal.previousQuantity ?? 0
        const baselineStillValid = liveQuantity !== null && liveQuantity === expectedBaseline
        if (baselineStillValid) progress.approved += 1
        else progress.blocked += 1
        break
      }
      default: {
        break
      }
    }
  }

  progress.allReviewed = progress.pending === 0
  progress.allApplicableApplied = progress.allReviewed && progress.approved === 0 && progress.blocked === 0
  progress.fullyComplete = progress.allApplicableApplied && progress.appliedSyncPending === 0 && progress.appliedSyncFailed === 0

  return progress
}
