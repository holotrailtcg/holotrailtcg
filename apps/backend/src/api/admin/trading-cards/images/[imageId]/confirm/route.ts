import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveR2ImageStorageClient } from "../../../dependencies"
import {
  adminActor, imageIdParamsSchema, parseAdminInput, safeAdminWrite,
  toSafeCardImageDto, tradingCardsService,
} from "../../../shared"
import { syncTradingCardProductMedia } from "../../../../../../workflows/trading-cards/sync-product-media"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { imageId } = parseAdminInput(imageIdParamsSchema, req.params)
  const service = tradingCardsService(req)
  const r2Client = resolveR2ImageStorageClient(req.scope)
  const actor = adminActor(req)

  const saved = await safeAdminWrite(() => service.confirmPendingCardImage({
    id: imageId, actor, source: "MANUAL", r2Client,
  }))

  try {
    await syncTradingCardProductMedia(req.scope, (saved as Record<string, unknown>).trading_card_variant_id as string)
  } catch (error) {
    // The photograph is already durably READY. Do not report the upload as
    // failed if the secondary Medusa projection is temporarily unavailable;
    // proposal application retries the same idempotent projection.
    console.error(`[trading-cards] failed to sync product media after confirming image ${imageId}`, error)
  }

  res.status(200).json(await toSafeCardImageDto(service, saved as Record<string, unknown>))
}
