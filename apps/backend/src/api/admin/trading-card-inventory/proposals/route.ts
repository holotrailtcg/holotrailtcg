import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  attachCardIdentities, parseAdminInput, proposalListQuerySchema, safeAdminRead, toSafeInventoryProposalDto,
  tradingCardInventoryService,
} from "../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(proposalListQuerySchema, req.query)
  const filters: Record<string, unknown> = {}
  if (query.inventorySourceId) filters.inventory_source_id = query.inventorySourceId
  if (query.inventorySnapshotId) filters.inventory_snapshot_id = query.inventorySnapshotId
  if (query.tradingCardVariantId) filters.trading_card_variant_id = query.tradingCardVariantId
  if (query.changeKind) filters.change_kind = query.changeKind
  if (query.reviewStatus) filters.review_status = query.reviewStatus
  const [rows, count] = await safeAdminRead(() => tradingCardInventoryService(req).listAndCountInventoryProposals(
    filters, { skip: query.offset, take: query.limit, order: { created_at: "DESC" } },
  ))
  const proposals = await attachCardIdentities(req, rows.map((row: Record<string, unknown>) => toSafeInventoryProposalDto(row)))
  res.status(200).json({ proposals, count, limit: query.limit, offset: query.offset })
}
