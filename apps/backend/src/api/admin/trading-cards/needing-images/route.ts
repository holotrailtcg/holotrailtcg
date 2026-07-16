import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { imageListQuerySchema } from "../../../../modules/trading-cards/images/admin-image-review"
import { parseAdminInput, safeAdminRead, tradingCardsService } from "../shared"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(imageListQuerySchema, req.query)
  const result = await safeAdminRead(() => tradingCardsService(req).listCardsNeedingImages(query))
  res.status(200).json(result)
}
