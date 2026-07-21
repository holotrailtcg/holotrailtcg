import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { ApplyInventoryProposalItemResult } from "../../modules/trading-card-inventory/service"
import { MEDUSA_SYNC_STATUS, type InventoryProposalChangeKind, type InventoryRecordSource } from "../../modules/trading-card-inventory/types"
import { syncInventoryProposalToMedusa } from "./medusa-inventory-sync"
import { advanceSnapshotProgressIfComplete } from "./advance-snapshot-progress"
import { syncTradingCardProductMedia } from "../trading-cards/sync-product-media"

export interface ApplyInventoryProposalsWithSyncInput {
  actor: string
  source: InventoryRecordSource
  reason?: string | null
  ids: string[]
}

/**
 * Phase A (atomic local application) followed by a best-effort Phase B
 * (Medusa sync) per successfully-applied proposal, then snapshot-progress
 * recomputation for every affected snapshot. Phase B is intentionally
 * sequential per proposal and never rolls back Phase A: a Medusa sync
 * failure leaves the proposal `APPLIED` with `medusa_sync_status = FAILED`,
 * retried later via `retryInventoryProposalSync` — see ADR 0011.
 */
export async function applyInventoryProposalsWithSync(
  container: MedusaContainer,
  input: ApplyInventoryProposalsWithSyncInput
): Promise<{ results: ApplyInventoryProposalItemResult[] }> {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const auditContext = { actor: input.actor, source: input.source, reason: input.reason }

  const { results } = await inventory.applyInventoryProposals({ ...auditContext, ids: input.ids })

  for (const result of results) {
    const locallyApplied = result.localApplicationStatus === "APPLIED" || result.localApplicationStatus === "ALREADY_APPLIED"
    if (!locallyApplied || result.medusaSyncStatus === MEDUSA_SYNC_STATUS.SYNCED) continue

    const { attemptToken } = await inventory.beginMedusaSyncAttempt({ ...auditContext, proposalId: result.proposalId })
    if (!attemptToken) continue // already SYNCED, or a concurrent attempt is in flight

    const proposal = await inventory.retrieveInventoryProposal(result.proposalId)
    const syncResult = await syncInventoryProposalToMedusa(container, {
      proposalId: result.proposalId,
      tradingCardVariantId: proposal.trading_card_variant_id as string,
      proposedQuantity: proposal.proposed_quantity as number,
      attemptToken,
      changeKind: proposal.change_kind as InventoryProposalChangeKind,
      confirmedEbayStoreCategoryId: (proposal.confirmed_ebay_store_category_id as string | null) ?? null,
    })

    const saved = await inventory.recordMedusaSyncResult(
      syncResult.outcome === "SYNCED"
        ? {
            ...auditContext, proposalId: result.proposalId, attemptToken, outcome: "SYNCED",
            medusaInventoryItemId: syncResult.medusaInventoryItemId, medusaStockLocationId: syncResult.medusaStockLocationId,
          }
        : {
            ...auditContext, proposalId: result.proposalId, attemptToken, outcome: "FAILED",
            error: { category: syncResult.category, message: syncResult.message },
          }
    )
    result.medusaSyncStatus = saved.medusa_sync_status as ApplyInventoryProposalItemResult["medusaSyncStatus"]

    if (syncResult.outcome === "SYNCED") {
      try {
        await syncTradingCardProductMedia(container, proposal.trading_card_variant_id as string)
      } catch (error) {
        // Product media is a separate, idempotent projection and must not
        // turn a successful absolute inventory sync into a false failure.
        console.error(`[trading-card-inventory] failed to sync product media for proposal ${result.proposalId}`, error)
      }
    }
  }

  const snapshotIds = new Set<string>()
  if (results.length > 0) {
    const savedProposals = (await inventory.listInventoryProposals({ id: results.map((result) => result.proposalId) })) as Record<
      string,
      unknown
    >[]
    for (const proposal of savedProposals) {
      const snapshotId = proposal.inventory_snapshot_id as string | null
      if (snapshotId) snapshotIds.add(snapshotId)
    }
  }
  for (const snapshotId of snapshotIds) {
    await advanceSnapshotProgressIfComplete(container, snapshotId, auditContext)
  }

  return { results }
}

const applyInventoryProposalsStep = createStep(
  "apply-inventory-proposals",
  async (input: ApplyInventoryProposalsWithSyncInput, { container }) =>
    new StepResponse(await applyInventoryProposalsWithSync(container, input))
)

export const applyInventoryProposalsWorkflow = createWorkflow(
  "apply-inventory-proposals",
  (input: ApplyInventoryProposalsWithSyncInput) => new WorkflowResponse(applyInventoryProposalsStep(input))
)
