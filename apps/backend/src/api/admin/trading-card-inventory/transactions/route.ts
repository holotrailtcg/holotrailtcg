import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseAdminInput, safeAdminRead, toSafeInventoryTransactionDto, tradingCardInventoryService, transactionListQuerySchema } from "../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(transactionListQuerySchema, req.query)
  const service = tradingCardInventoryService(req)
  const filters: Record<string, unknown> = {}
  if (query.inventorySourceId) filters.inventory_source_id = query.inventorySourceId
  if (query.tradingCardVariantId) filters.trading_card_variant_id = query.tradingCardVariantId
  const [rows, count] = await safeAdminRead(() =>
    service.listAndCountInventoryTransactions(filters, { skip: query.offset, take: query.limit, order: { created_at: "DESC" } })
  )
  res.status(200).json({
    transactions: rows.map((row: Record<string, unknown>) => toSafeInventoryTransactionDto(row)),
    count, limit: query.limit, offset: query.offset,
  })
}
