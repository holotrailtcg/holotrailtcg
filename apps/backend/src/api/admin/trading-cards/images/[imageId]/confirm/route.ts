import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveR2ImageStorageClient } from "../../../dependencies"
import {
  adminActor, imageIdParamsSchema, parseAdminInput, safeAdminWrite,
  toSafeCardImageDto, tradingCardsService,
} from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { imageId } = parseAdminInput(imageIdParamsSchema, req.params)
  const service = tradingCardsService(req)
  const r2Client = resolveR2ImageStorageClient(req.scope)
  const actor = adminActor(req)

  const saved = await safeAdminWrite(() => service.confirmPendingCardImage({
    id: imageId, actor, source: "MANUAL", r2Client,
  }))

  res.status(200).json(await toSafeCardImageDto(service, saved as Record<string, unknown>))
}
