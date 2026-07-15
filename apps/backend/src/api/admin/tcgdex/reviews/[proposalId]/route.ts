import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proposalIdParamsSchema } from "../../../../../modules/trading-cards/tcgdex/admin-review"
import { parseAdminInput, safeAdminRead, tradingCardsService } from "../../shared"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { proposalId } = parseAdminInput(proposalIdParamsSchema, req.params)
  const result = await safeAdminRead(() => tradingCardsService(req).retrieveTcgdexAdminReview(proposalId))
  res.status(200).json(result)
}
