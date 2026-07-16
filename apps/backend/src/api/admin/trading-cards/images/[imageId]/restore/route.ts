import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  adminActor, imageIdParamsSchema, parseAdminInput, safeAdminWrite,
  toSafeCardImageDto, tradingCardsService,
} from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { imageId } = parseAdminInput(imageIdParamsSchema, req.params)
  const service = tradingCardsService(req)
  const actor = adminActor(req)

  const saved = await safeAdminWrite(() => service.restoreCardImage({
    id: imageId, actor, source: "MANUAL",
  }))

  res.status(200).json(await toSafeCardImageDto(service, saved as Record<string, unknown>))
}
