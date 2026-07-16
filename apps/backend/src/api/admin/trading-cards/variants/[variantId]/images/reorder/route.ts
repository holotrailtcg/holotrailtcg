import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  adminActor, parseAdminInput, reorderBodySchema, safeAdminWrite,
  toSafeCardImageDto, tradingCardsService, variantIdParamsSchema,
} from "../../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { variantId } = parseAdminInput(variantIdParamsSchema, req.params)
  const body = parseAdminInput(reorderBodySchema, req.body)
  const service = tradingCardsService(req)
  const actor = adminActor(req)

  const saved = await safeAdminWrite(() => service.reorderReadyCardImages({
    tradingCardVariantId: variantId, orderedImageIds: body.orderedImageIds, actor, source: "MANUAL",
  }))

  res.status(200).json({ images: await Promise.all(saved.map((row) => toSafeCardImageDto(service, row))) })
}
