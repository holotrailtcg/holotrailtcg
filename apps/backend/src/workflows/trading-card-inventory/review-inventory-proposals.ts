import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { ReviewInventoryProposalsInput } from "../../modules/trading-card-inventory/service"
import { advanceSnapshotProgressIfComplete } from "./advance-snapshot-progress"

/**
 * Bulk (all-or-nothing) approve/reject, used for both the single-id and
 * multi-id cases. Recomputes snapshot progress for every affected snapshot
 * afterward — rejecting the last pending proposal in a snapshot can make it
 * `fullyComplete` without any proposal ever being applied.
 */
export async function reviewInventoryProposalsWithProgress(
  container: MedusaContainer,
  input: ReviewInventoryProposalsInput
) {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const saved = await inventory.reviewInventoryProposals(input)
  const snapshotIds = [
    ...new Set(saved.map((proposal) => proposal.inventory_snapshot_id as string | null).filter((id): id is string => Boolean(id))),
  ]
  for (const snapshotId of snapshotIds) {
    await advanceSnapshotProgressIfComplete(container, snapshotId, input)
  }
  return saved
}

const reviewInventoryProposalsStep = createStep(
  "review-inventory-proposals",
  async (input: ReviewInventoryProposalsInput, { container }) =>
    new StepResponse(await reviewInventoryProposalsWithProgress(container, input))
)

export const reviewInventoryProposalsWorkflow = createWorkflow(
  "review-inventory-proposals",
  (input: ReviewInventoryProposalsInput) => new WorkflowResponse(reviewInventoryProposalsStep(input))
)
