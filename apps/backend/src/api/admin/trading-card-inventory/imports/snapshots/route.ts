import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseAdminInput, safeAdminRead, snapshotListQuerySchema, toSafeInventorySnapshotListItemDto, tradingCardInventoryService } from "../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(snapshotListQuerySchema, req.query)
  const filters: Record<string, unknown> = {}
  if (query.inventorySourceId) filters.inventory_source_id = query.inventorySourceId
  if (query.status) filters.status = query.status

  const [rows, count] = await safeAdminRead(() => tradingCardInventoryService(req).listAndCountInventorySnapshots(
    filters, { skip: query.offset, take: query.limit, order: { created_at: "DESC" } }
  ))
  res.status(200).json({
    snapshots: (rows as Record<string, unknown>[]).map((row) => toSafeInventorySnapshotListItemDto(row)),
    count, limit: query.limit, offset: query.offset,
  })
}
