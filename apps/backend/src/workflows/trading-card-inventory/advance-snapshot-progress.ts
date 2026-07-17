import type { MedusaContainer } from "@medusajs/framework/types"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import {
  computeInventorySnapshotProgress, type SnapshotProgress, type SnapshotProgressProposalRow,
} from "../../modules/trading-card-inventory/reconciliation/snapshot-progress"
import { INVENTORY_SNAPSHOT_STATUS, type InventoryRecordSource } from "../../modules/trading-card-inventory/types"

export interface AdvanceSnapshotProgressResult {
  progress: SnapshotProgress
  snapshotStatus: string
}

/**
 * Recomputes `SnapshotProgress` for one snapshot from current proposal/holding
 * state and, only if `fullyComplete` newly holds, drives the snapshot through
 * `APPROVED -> APPLYING -> APPLIED`. Called after every review, apply, and
 * sync-retry operation — this is the single place that ever moves a snapshot
 * into `APPLIED`, and it never trusts anything but freshly-read DB state (see
 * ADR 0011). A snapshot outside `{APPROVED, APPLYING, APPLIED}` is left
 * untouched: applying proposals is only ever expected once a snapshot has
 * been approved, and this helper must not paper over an unexpected state by
 * forcing an invalid transition.
 */
export async function advanceSnapshotProgressIfComplete(
  container: MedusaContainer,
  snapshotId: string,
  auditContext: { actor: string; source: InventoryRecordSource; reason?: string | null }
): Promise<AdvanceSnapshotProgressResult> {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const snapshot = await inventory.retrieveInventorySnapshot(snapshotId)
  const snapshotStatus = snapshot.status as string

  const proposals = (await inventory.listInventoryProposals({ inventory_snapshot_id: snapshotId })) as Record<string, unknown>[]
  const rows: SnapshotProgressProposalRow[] = proposals.map((proposal) => ({
    id: proposal.id as string,
    reviewStatus: proposal.review_status as SnapshotProgressProposalRow["reviewStatus"],
    medusaSyncStatus: proposal.medusa_sync_status as SnapshotProgressProposalRow["medusaSyncStatus"],
    changeKind: proposal.change_kind as SnapshotProgressProposalRow["changeKind"],
    tradingCardVariantId: (proposal.trading_card_variant_id as string | null) ?? null,
    previousQuantity: (proposal.previous_quantity as number | null) ?? null,
  }))

  const variantIds = [...new Set(rows.map((row) => row.tradingCardVariantId).filter((id): id is string => Boolean(id)))]
  const holdingQuantityByVariantId = new Map<string, number>()
  if (variantIds.length > 0) {
    const holdings = (await inventory.listInventoryHoldings({
      inventory_source_id: snapshot.inventory_source_id as string, trading_card_variant_id: variantIds,
    })) as Record<string, unknown>[]
    for (const holding of holdings) {
      holdingQuantityByVariantId.set(holding.trading_card_variant_id as string, holding.quantity as number)
    }
  }

  const progress = computeInventorySnapshotProgress(rows, holdingQuantityByVariantId)

  const canAdvance = snapshotStatus === INVENTORY_SNAPSHOT_STATUS.APPROVED || snapshotStatus === INVENTORY_SNAPSHOT_STATUS.APPLYING
  if (!progress.fullyComplete || !canAdvance) {
    return { progress, snapshotStatus }
  }

  if (snapshotStatus === INVENTORY_SNAPSHOT_STATUS.APPROVED) {
    await inventory.transitionInventorySnapshotStatus({
      ...auditContext, id: snapshotId, targetStatus: INVENTORY_SNAPSHOT_STATUS.APPLYING,
    })
  }
  const applied = await inventory.transitionInventorySnapshotStatus({
    ...auditContext, id: snapshotId, targetStatus: INVENTORY_SNAPSHOT_STATUS.APPLIED,
  })
  return { progress, snapshotStatus: applied.status as string }
}
