import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { INVENTORY_SNAPSHOT_STATUS, type InventoryRecordSource } from "../../modules/trading-card-inventory/types"

export interface DiscardInventorySnapshotInput {
  actor: string
  source: InventoryRecordSource
  reason?: string | null
  id: string
}

/**
 * Removes a not-yet-applied snapshot from the working "Check and approve"
 * list without deleting anything. `transitionInventorySnapshotStatus`
 * enforces the transition table (`INVENTORY_SNAPSHOT_STATUS_TRANSITIONS`),
 * which only allows DISCARDED from states where nothing has touched real
 * stock yet — APPLIED/APPLYING snapshots are rejected there, not here, so
 * this can never hide a snapshot that already moved inventory.
 */
export async function discardInventorySnapshot(container: MedusaContainer, input: DiscardInventorySnapshotInput) {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  return inventory.transitionInventorySnapshotStatus({
    actor: input.actor, source: input.source, reason: input.reason ?? "Discarded via Admin",
    id: input.id, targetStatus: INVENTORY_SNAPSHOT_STATUS.DISCARDED,
  })
}

const discardInventorySnapshotStep = createStep(
  "discard-inventory-snapshot",
  async (input: DiscardInventorySnapshotInput, { container }) =>
    new StepResponse(await discardInventorySnapshot(container, input)),
)

export const discardInventorySnapshotWorkflow = createWorkflow(
  "discard-inventory-snapshot",
  (input: DiscardInventorySnapshotInput) => new WorkflowResponse(discardInventorySnapshotStep(input)),
)
