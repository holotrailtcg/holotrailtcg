import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INVENTORY_HOLDING_STATUS, INVENTORY_PROPOSAL_REVIEW_STATUS } from "../../../../../../modules/trading-card-inventory/types"
import { idParamsSchema, parseAdminInput, safeAdminRead, toSafeInventorySourceDto, tradingCardInventoryService } from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const service = tradingCardInventoryService(req)

  const summary = await safeAdminRead(async () => {
    const source = await service.retrieveInventorySource(id).catch(() => null)
    if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")

    const [latestSnapshots] = await service.listAndCountInventorySnapshots(
      { inventory_source_id: id }, { skip: 0, take: 1, order: { sequence_number: "DESC" } }
    )
    const latestSnapshot = latestSnapshots[0] ?? null

    const [, approvedHoldingCount] = await service.listAndCountInventoryHoldings(
      { inventory_source_id: id, status: INVENTORY_HOLDING_STATUS.READY }, { skip: 0, take: 0 }
    )
    const readyHoldings = await service.listInventoryHoldings(
      { inventory_source_id: id, status: INVENTORY_HOLDING_STATUS.READY }
    )
    const totalGroupedQuantity = readyHoldings.reduce((sum, holding) => sum + (holding.quantity ?? 0), 0)

    const [, draftHoldingCount] = await service.listAndCountInventoryHoldings(
      { inventory_source_id: id, status: INVENTORY_HOLDING_STATUS.DRAFT }, { skip: 0, take: 0 }
    )
    const [, archivedHoldingCount] = await service.listAndCountInventoryHoldings(
      { inventory_source_id: id, status: INVENTORY_HOLDING_STATUS.ARCHIVED }, { skip: 0, take: 0 }
    )

    const [, unresolvedProposalCount] = await service.listAndCountInventoryProposals(
      { inventory_source_id: id, review_status: INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING }, { skip: 0, take: 0 }
    )

    return {
      source: toSafeInventorySourceDto(source as Record<string, unknown>),
      latestSnapshot: latestSnapshot
        ? { id: latestSnapshot.id, status: latestSnapshot.status, sequenceNumber: latestSnapshot.sequence_number, createdAt: latestSnapshot.created_at }
        : null,
      approvedHoldingCount,
      totalGroupedQuantity,
      holdingStatusCounts: { draft: draftHoldingCount, ready: approvedHoldingCount, archived: archivedHoldingCount },
      unresolvedProposalCount,
    }
  })

  res.status(200).json(summary)
}
