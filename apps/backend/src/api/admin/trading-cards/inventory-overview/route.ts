import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { getInventoryOverview } from "../../../../modules/trading-card-inventory/reporting/get-inventory-overview"
import { parseAdminInput, safeAdminRead } from "../shared"

const inventoryOverviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
}).strict()

/**
 * Read-only dashboard + table data for the Admin "Card Inventory" page. See
 * `getInventoryOverview` for the aggregation rules (weighted-average
 * acquisition cost, most-recent market price, live Medusa stock quantity).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(inventoryOverviewQuerySchema, req.query)
  const { rows, count, totals } = await safeAdminRead(() =>
    getInventoryOverview(req.scope, { limit: query.limit, offset: query.offset })
  )
  res.status(200).json({ rows, count, limit: query.limit, offset: query.offset, totals })
}
