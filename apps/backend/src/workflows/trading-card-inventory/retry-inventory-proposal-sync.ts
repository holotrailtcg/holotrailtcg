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
 * concurrent attempt holds a non-expired token, so at most one retry proceeds
 * during the lease while an interrupted attempt remains recoverable.
 */
export async function retryInventoryProposalSync(container: MedusaContainer, input: RetryInventoryProposalSyncInput) {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const auditContext = { actor: input.actor, source: input.source, reason: input.reason }

  const { attemptToken } = await inventory.beginMedusaSyncAttempt({ ...auditContext, proposalId: input.proposalId })
  if (!attemptToken) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "This proposal is already synced or a non-expired sync attempt is in flight")
  }

  const proposal = await inventory.retrieveInventoryProposal(input.proposalId)

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
