import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveR2Config } from "../../../../../modules/trading-cards/images/r2-config"
import { parseAdminInput, safeAdminRead, tradingCardsService, variantThumbnailsQuerySchema } from "../../shared"

/**
 * Batched "what image should this row show" lookup for the import review
 * table — one request for a whole page of rows instead of one per row.
 * Real photograph wins over TCGdex reference art; neither yields `null`,
 * which the table renders as a placeholder.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { variantIds } = parseAdminInput(variantThumbnailsQuerySchema, req.query)
  const config = resolveR2Config()

  const thumbnails = await safeAdminRead(() =>
    tradingCardsService(req).listThumbnailsForVariants({
      variantIds,
      publicBaseUrl: config.enabled ? config.publicBaseUrl : null,
    })
  )

  res.status(200).json({ thumbnails })
}
