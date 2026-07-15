import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { attemptListQuerySchema } from "../../../../modules/trading-cards/tcgdex/admin-review"
import { parseAdminInput, safeAdminRead, tradingCardsService } from "../shared"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(attemptListQuerySchema, req.query)
  const result = await safeAdminRead(() => tradingCardsService(req).listTcgdexAdminAttempts(query))
  res.status(200).json(result)
}
