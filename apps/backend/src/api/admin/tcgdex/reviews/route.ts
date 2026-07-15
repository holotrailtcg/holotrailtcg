import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { reviewListQuerySchema } from "../../../../modules/trading-cards/tcgdex/admin-review"
import { parseAdminInput, safeAdminRead, tradingCardsService } from "../shared"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(reviewListQuerySchema, req.query)
  const result = await safeAdminRead(() => tradingCardsService(req).listTcgdexAdminReviews(query))
  res.status(200).json(result)
}
