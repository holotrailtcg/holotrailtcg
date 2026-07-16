import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { idParamsSchema, parseAdminInput, safeAdminRead, tradingCardInventoryService } from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const summary = await safeAdminRead(() => tradingCardInventoryService(req).getReconciliationSummary(id))
  res.status(200).json(summary)
}
