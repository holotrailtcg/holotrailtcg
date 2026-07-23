import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROPOSAL_REVIEW_STATUS } from "../../modules/trading-card-inventory/types"

const APPLICABLE_CHANGE_KINDS: string[] = [INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING, INVENTORY_PROPOSAL_CHANGE_KIND.QUANTITY_CHANGE]

export interface PublishInventoryProposalsInput {
  snapshotId: string
  actor: string
  source: "MANUAL"
  /** Restricts to exactly these proposal ids ("Publish selected"). Omit for every eligible proposal on the snapshot ("Publish all"). */
  ids?: string[]
  /** Chunk window over the deterministically-ordered eligible set — lets a large snapshot be published across several requests instead of one long-running call. */
  limit?: number
  /**
   * Resume cursor: process only proposals whose id sorts after this value.
   * The eligible set is recomputed on every call and a proposal that ends up
   * skipped (still needs "Create card", still needs its eBay category, or
   * errors) never leaves it, so a numeric offset would either reprocess the
   * same stuck rows forever or skip past proposals that legitimately remain
   * eligible. An id cursor advances monotonically regardless of whether
   * earlier rows left the eligible set. Omit to start from the beginning.
   */
  afterId?: string
}

export interface PublishInventoryProposalsResult {
  processedCount: number
  totalEligibleCount: number
  remainingCount: number
  approvedCount: number
  appliedCount: number
  skippedCount: number
  errors: string[]
  /** Pass this back as `afterId` on the next call to continue past this batch; omit once `remainingCount` is 0. */
  nextCursor: string | null
}

/** A row still PENDING is publishable only once it has a resolved card variant — otherwise it needs "Create card" first. */
function isPendingPublishable(row: Record<string, unknown>): boolean {
  return row.review_status === INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING && Boolean(row.trading_card_variant_id)
}

/** Mirrors the Admin table's own `selectionKind` "APPLY" gate exactly — never invent a looser rule here than what a reviewer could already do one row at a time. */
function isApplyEligible(row: Record<string, unknown>): boolean {
  if (row.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED) return false
  if (!row.trading_card_variant_id || row.proposed_quantity === null || row.proposed_quantity === undefined) return false
  if (!APPLICABLE_CHANGE_KINDS.includes(row.change_kind as string)) return false
  if (row.change_kind === INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING && !row.confirmed_ebay_store_category_id) return false
  return true
}

function isEligibleForPublish(row: Record<string, unknown>): boolean {
  return isPendingPublishable(row) || isApplyEligible(row)
}

/**
 * "Publish" = Approve then Apply in one action, for every proposal that's
 * ready for it — the existing two-step review is unchanged underneath (same
 * `reviewInventoryProposals`/`applyInventoryProposal` calls a reviewer would
 * trigger by hand), this just chains them per proposal so a reviewer doesn't
 * have to click twice per row. A proposal still needing "Create card" first,
 * or a `NEW_HOLDING` still needing its eBay category confirmed, is skipped
 * (never silently forced) and counted in `skippedCount`.
 *
 * Deliberately queries every in-scope proposal on the snapshot (or the
 * caller's explicit `ids`) rather than trusting a client-supplied page of
 * rows — the same "only processed what was on screen" bug already fixed for
 * TCGdex candidate bulk-approve must not be repeated here.
 */
export async function publishInventoryProposalsForSnapshot(
  container: MedusaContainer,
  input: PublishInventoryProposalsInput,
): Promise<PublishInventoryProposalsResult> {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)

  const allProposals = (await inventory.listInventoryProposals({
    inventory_snapshot_id: input.snapshotId,
    ...(input.ids ? { id: input.ids } : {}),
  })) as Record<string, unknown>[]

  const eligible = allProposals.filter(isEligibleForPublish).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const candidates = input.afterId
    ? eligible.filter((p) => String(p.id) > input.afterId!)
    : eligible
  const batch = input.limit ? candidates.slice(0, input.limit) : candidates

  let approvedCount = 0
  let appliedCount = 0
  let skippedCount = 0
  const errors: string[] = []

  for (const proposal of batch) {
    try {
      let current = proposal
      if (isPendingPublishable(current)) {
        const [approved] = await inventory.reviewInventoryProposals({
          actor: input.actor, source: input.source, ids: [current.id as string], targetStatus: "APPROVED",
        })
        current = approved
        approvedCount += 1
      }
      if (isApplyEligible(current)) {
        const result = await inventory.applyInventoryProposal({ actor: input.actor, source: input.source, id: current.id as string })
        if (result.localApplicationStatus === "APPLIED" || result.localApplicationStatus === "ALREADY_APPLIED") {
          appliedCount += 1
        } else {
          skippedCount += 1
          if (result.errorMessage) errors.push(`${current.id}: ${result.errorMessage}`)
        }
      } else {
        skippedCount += 1
      }
    } catch (error) {
      skippedCount += 1
      const message = (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : String(error)
      errors.push(`${proposal.id}: ${message}`)
    }
  }

  return {
    processedCount: batch.length,
    totalEligibleCount: eligible.length,
    remainingCount: Math.max(0, candidates.length - batch.length),
    approvedCount, appliedCount, skippedCount, errors,
    nextCursor: batch.length > 0 ? String(batch[batch.length - 1].id) : input.afterId ?? null,
  }
}

const publishInventoryProposalsStep = createStep(
  "publish-inventory-proposals",
  async (input: PublishInventoryProposalsInput, { container }) =>
    new StepResponse(await publishInventoryProposalsForSnapshot(container, input)),
)

export const publishInventoryProposalsWorkflow = createWorkflow(
  "publish-inventory-proposals",
  (input: PublishInventoryProposalsInput) => new WorkflowResponse(publishInventoryProposalsStep(input)),
)
