import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  adminActor, focalPointBodySchema, imageIdParamsSchema, parseAdminInput, safeAdminWrite,
  toSafeCardImageDto, tradingCardsService,
} from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { imageId } = parseAdminInput(imageIdParamsSchema, req.params)
  const body = parseAdminInput(focalPointBodySchema, req.body)
  const service = tradingCardsService(req)
  const actor = adminActor(req)

  const saved = await safeAdminWrite(() => service.updateCardImageFocalPoint({
    id: imageId, focalX: body.focalX, focalY: body.focalY, actor, source: "MANUAL",
  }))

  res.status(200).json(await toSafeCardImageDto(service, saved as Record<string, unknown>))
}
