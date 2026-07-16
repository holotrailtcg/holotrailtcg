import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { ReconcileInventorySnapshotInput } from "../../modules/trading-card-inventory/service"

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
  return inventory.reconcileInventorySnapshot({
    ...input,
    priceLockedVariantIds: variants.filter((variant) => variant.price_locked).map((variant) => variant.id),
  })
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
