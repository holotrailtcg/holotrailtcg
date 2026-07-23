import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { CategoryAssignmentCardAttributes, CategoryAssignmentResult } from "../../modules/ebay-integration/category-assignment/evaluate"
import type { EbayEnvironment } from "../../modules/ebay-integration/types"
import { applyCategoryAssignmentToProposal, resolveCategoryAssignmentDependencies, resolveCategoryAssignmentEnvironment } from "./category-assignment-shared"

export interface RecomputeProposalCategoriesInput {
  snapshotId: string
  /** Overrides environment auto-detection — used by the CLI script for an explicit choice; the Admin action never needs this. */
  environment?: EbayEnvironment
  /** Chunk window over the deterministically-ordered eligible set — lets a large snapshot be synced across several requests instead of one long-running call. Omit both for "process everything in one call" (the CLI script's default). */
  limit?: number
  /**
   * Resume cursor: process only proposals whose id sorts after this value.
   * The eligible set is recomputed on every call and a proposal that fails to
   * confirm (e.g. FALLBACK/NO_MATCH) never leaves it, so a numeric offset
   * would either reprocess the same stuck rows forever or skip past
   * proposals that legitimately remain eligible. An id cursor advances
   * monotonically regardless of whether earlier rows left the eligible set.
   */
  afterId?: string
}

export interface RecomputeProposalCategoriesResult {
  recomputedCount: number
  /** Total eligible (unconfirmed, in-scope) proposals at the moment this batch was computed. */
  totalEligibleCount: number
  remainingCount: number
  /** Pass this back as `afterId` on the next call to continue past this batch; omit once `remainingCount` is 0. */
  nextCursor: string | null
  results: Array<{ proposalId: unknown; attributes: CategoryAssignmentCardAttributes; result: CategoryAssignmentResult }>
}

/**
 * Re-runs `evaluateCategoryAssignment` against every PENDING/APPROVED,
 * in-scope proposal on a snapshot that isn't confirmed yet, and overwrites
 * its stored category proposal (auto-confirming a fresh `RULE_MATCH` along
 * the way) — needed because the automatic reconcile-time annotation only
 * ever computes a proposal once, so a proposal created before a rule existed
 * (or before it matched correctly) never picks the rule up on its own.
 * Shared by the Admin "Sync eBay categories" action and the
 * `recompute-proposal-categories` ops script.
 *
 * Safe to interrupt and restart from scratch at any time (e.g. an
 * accidental page refresh mid-sync): every proposal here is a plain,
 * independent, immediately-persisted update — there is no multi-step
 * transaction spanning the whole batch, and re-evaluating an
 * already-processed proposal is harmless (a `RULE_MATCH` proposal is already
 * confirmed and excluded from the next query; anything else just gets
 * recomputed to the same or a now-more-current result).
 */
export async function recomputeProposalCategoriesForSnapshot(
  container: MedusaContainer,
  input: RecomputeProposalCategoriesInput,
): Promise<RecomputeProposalCategoriesResult> {
  const { inventory, ebayIntegration, cards } = resolveCategoryAssignmentDependencies(container)

  const environment = input.environment ?? await resolveCategoryAssignmentEnvironment(ebayIntegration)
  if (!environment) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No single CONNECTED eBay environment was found — connect exactly one environment before syncing categories.",
    )
  }

  const allEligible = (await inventory.listInventoryProposals({
    inventory_snapshot_id: input.snapshotId,
    change_kind: ["NEW_HOLDING", "UNRESOLVED_VARIANT"],
  }) as Record<string, unknown>[]).filter((p) =>
    (p.review_status === "PENDING" || p.review_status === "APPROVED") && !p.confirmed_ebay_store_category_id,
  ).sort((a, b) => String(a.id).localeCompare(String(b.id)))

  const candidates = input.afterId
    ? allEligible.filter((p) => String(p.id) > input.afterId!)
    : allEligible
  const proposals = input.limit ? candidates.slice(0, input.limit) : candidates

  const snapshot = await inventory.retrieveInventorySnapshot(input.snapshotId)
  const source = await inventory.retrieveInventorySource(snapshot.inventory_source_id as string)
  const language = (source.language as string | null) ?? null

  const results: RecomputeProposalCategoriesResult["results"] = []
  for (const proposal of proposals) {
    const { attributes, result } = await applyCategoryAssignmentToProposal(
      inventory, ebayIntegration, cards, environment, input.snapshotId, language, proposal,
    )
    results.push({ proposalId: proposal.id, attributes, result })
  }

  return {
    recomputedCount: results.length,
    totalEligibleCount: allEligible.length,
    remainingCount: Math.max(0, candidates.length - proposals.length),
    nextCursor: proposals.length > 0 ? String(proposals[proposals.length - 1].id) : input.afterId ?? null,
    results,
  }
}

const recomputeProposalCategoriesStep = createStep(
  "recompute-proposal-categories",
  async (input: RecomputeProposalCategoriesInput, { container }) =>
    new StepResponse(await recomputeProposalCategoriesForSnapshot(container, input)),
)

export const recomputeProposalCategoriesWorkflow = createWorkflow(
  "recompute-proposal-categories",
  (input: RecomputeProposalCategoriesInput) => new WorkflowResponse(recomputeProposalCategoriesStep(input)),
)
