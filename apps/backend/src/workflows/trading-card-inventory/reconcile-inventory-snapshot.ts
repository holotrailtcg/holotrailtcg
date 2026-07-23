import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { ReconcileInventorySnapshotInput } from "../../modules/trading-card-inventory/service"
import { INVENTORY_PROPOSAL_CHANGE_KIND } from "../../modules/trading-card-inventory/types"
import { applyCategoryAssignmentToProposal, resolveCategoryAssignmentDependencies, resolveCategoryAssignmentEnvironment } from "./category-assignment-shared"

/** Bulk-loads Stage 3 price locks once, then delegates the atomic comparison/write to the inventory module. */
export async function reconcileInventorySnapshotWithPriceLocks(
  container: MedusaContainer,
  input: ReconcileInventorySnapshotInput,
) {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const snapshotIds = [input.snapshotId, input.previousApprovedSnapshotId].filter((id): id is string => Boolean(id))
  const variantIds = await inventory.listSnapshotVariantIds(snapshotIds)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const variants = variantIds.length > 0 ? await cards.listTradingCardVariants({ id: variantIds }) : []
  const reconciliation = await inventory.reconcileInventorySnapshot({
    ...input,
    priceLockedVariantIds: variants.filter((variant) => variant.price_locked).map((variant) => variant.id),
  })

  // E2B: annotate newly-created proposals with a computed category
  // assignment. Best-effort and additive — any failure here (no connected
  // eBay environment yet, no rules configured, a lookup error) simply
  // leaves affected proposals without a proposed category, which correctly
  // falls through to "requires a manual Admin choice" rather than blocking
  // reconciliation itself.
  try {
    await annotateCategoryProposals(container, input.snapshotId)
  } catch (error) {
    console.error(`[trading-card-inventory] failed to compute category proposals for snapshot ${input.snapshotId}`, error)
  }

  return reconciliation
}

/**
 * Computes a category proposal only for proposals that don't have one yet
 * (`proposed_ebay_store_category_id: null`) — a brand-new proposal has never
 * been evaluated. This intentionally never revisits an already-computed
 * proposal (e.g. after a rule changes); that's what the Admin "Sync eBay
 * categories" action / `recompute-proposal-categories` script are for.
 */
async function annotateCategoryProposals(container: MedusaContainer, snapshotId: string): Promise<void> {
  const { inventory, ebayIntegration, cards } = resolveCategoryAssignmentDependencies(container)

  const environment = await resolveCategoryAssignmentEnvironment(ebayIntegration)
  if (!environment) return

  const proposals = (await inventory.listInventoryProposals({
    inventory_snapshot_id: snapshotId,
    change_kind: [INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING, INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT],
    proposed_ebay_store_category_id: null,
  })) as Record<string, unknown>[]
  if (proposals.length === 0) return

  const snapshot = await inventory.retrieveInventorySnapshot(snapshotId)
  const source = await inventory.retrieveInventorySource(snapshot.inventory_source_id as string)
  const language = (source.language as string | null) ?? null

  for (const proposal of proposals) {
    await applyCategoryAssignmentToProposal(inventory, ebayIntegration, cards, environment, snapshotId, language, proposal)
  }
}

const reconcileInventorySnapshotStep = createStep(
  "reconcile-inventory-snapshot",
  async (input: ReconcileInventorySnapshotInput, { container }) =>
    new StepResponse(await reconcileInventorySnapshotWithPriceLocks(container, input)),
)

export const reconcileInventorySnapshotWorkflow = createWorkflow(
  "reconcile-inventory-snapshot",
  (input: ReconcileInventorySnapshotInput) => new WorkflowResponse(reconcileInventorySnapshotStep(input)),
)
