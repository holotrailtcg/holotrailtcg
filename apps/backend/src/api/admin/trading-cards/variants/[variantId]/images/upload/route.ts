import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveR2ImageStorageClient } from "../../../../dependencies"
import {
  adminActor, beginUploadBodySchema, parseAdminInput, safeAdminWrite,
  tradingCardsService, variantIdParamsSchema,
} from "../../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { variantId } = parseAdminInput(variantIdParamsSchema, req.params)
  const body = parseAdminInput(beginUploadBodySchema, req.body)
  const service = tradingCardsService(req)
  const r2Client = resolveR2ImageStorageClient(req.scope)
  const actor = adminActor(req)

  const { image, presigned } = await safeAdminWrite(() => service.beginCardImageUpload({
    tradingCardVariantId: variantId, uploadedBy: actor, originalFilename: body.originalFilename,
    declaredMimeType: body.declaredMimeType, declaredByteSize: body.declaredByteSize,
    actor, source: "MANUAL", r2Client,
  }))

  res.status(201).json({
    uploadUrl: presigned.uploadUrl,
    objectKey: image.staging_object_key,
    imageId: image.id,
    expiresAt: presigned.expiresAt,
    requiredHeaders: presigned.requiredHeaders,
  })
}
