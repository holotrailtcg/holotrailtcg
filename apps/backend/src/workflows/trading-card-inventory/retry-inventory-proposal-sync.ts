import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { InventoryRecordSource } from "../../modules/trading-card-inventory/types"
import { syncInventoryProposalToMedusa } from "./medusa-inventory-sync"
import { advanceSnapshotProgressIfComplete } from "./advance-snapshot-progress"

export interface RetryInventoryProposalSyncInput {
  actor: string
  source: InventoryRecordSource
  reason?: string | null
  proposalId: string
}

/**
 * Retries Phase B (Medusa sync) only, for one already-locally-`APPLIED`
 * proposal. `beginMedusaSyncAttempt` is the sole concurrency guard: it
 * refuses (returns a null token) if the proposal is already `SYNCED` or a
 * concurrent attempt already holds the current attempt token, so at most one
 * retry ever proceeds past that point.
 */
export async function retryInventoryProposalSync(container: MedusaContainer, input: RetryInventoryProposalSyncInput) {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const auditContext = { actor: input.actor, source: input.source, reason: input.reason }

  const proposal = await inventory.retrieveInventoryProposal(input.proposalId)
  if (proposal.medusa_sync_status !== "FAILED") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only a proposal with a FAILED Medusa sync can be retried")
  }

  const { attemptToken } = await inventory.beginMedusaSyncAttempt({ ...auditContext, proposalId: input.proposalId })
  if (!attemptToken) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This proposal is already synced or a sync attempt is already in flight")
  }

  const syncResult = await syncInventoryProposalToMedusa(container, {
    proposalId: input.proposalId,
    tradingCardVariantId: proposal.trading_card_variant_id as string,
    proposedQuantity: proposal.proposed_quantity as number,
    attemptToken,
  })

  const saved = await inventory.recordMedusaSyncResult(
    syncResult.outcome === "SYNCED"
      ? {
          ...auditContext, proposalId: input.proposalId, attemptToken, outcome: "SYNCED",
          medusaInventoryItemId: syncResult.medusaInventoryItemId, medusaStockLocationId: syncResult.medusaStockLocationId,
        }
      : {
          ...auditContext, proposalId: input.proposalId, attemptToken, outcome: "FAILED",
          error: { category: syncResult.category, message: syncResult.message },
        }
  )

  const snapshotId = saved.inventory_snapshot_id as string | null
  if (snapshotId) await advanceSnapshotProgressIfComplete(container, snapshotId, auditContext)

  return saved
}

const retryInventoryProposalSyncStep = createStep(
  "retry-inventory-proposal-sync",
  async (input: RetryInventoryProposalSyncInput, { container }) =>
    new StepResponse(await retryInventoryProposalSync(container, input))
)

export const retryInventoryProposalSyncWorkflow = createWorkflow(
  "retry-inventory-proposal-sync",
  (input: RetryInventoryProposalSyncInput) => new WorkflowResponse(retryInventoryProposalSyncStep(input))
)
