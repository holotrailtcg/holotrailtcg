import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  adminActor, imageIdParamsSchema, parseAdminInput, safeAdminWrite,
  toSafeCardImageDto, tradingCardsService,
} from "../../../shared"
import { syncTradingCardProductMedia } from "../../../../../../workflows/trading-cards/sync-product-media"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { imageId } = parseAdminInput(imageIdParamsSchema, req.params)
  const service = tradingCardsService(req)
  const actor = adminActor(req)

  const saved = await safeAdminWrite(() => service.archiveCardImage({
    id: imageId, adminId: actor, actor, source: "MANUAL",
  }))

  try {
    await syncTradingCardProductMedia(req.scope, (saved as Record<string, unknown>).trading_card_variant_id as string)
  } catch (error) {
    console.error(`[trading-cards] failed to sync product media after archiving image ${imageId}`, error)
  }

  res.status(200).json(await toSafeCardImageDto(service, saved as Record<string, unknown>))
}
