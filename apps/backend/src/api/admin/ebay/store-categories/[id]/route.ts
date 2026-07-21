import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateCategorySchema, service, parseAdminInput, adminActor, categoryWrite, correlation, triggerMedusaSync } from "../shared"
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(updateCategorySchema, req.body ?? {})
  const actorId = adminActor(req)
  const category = await categoryWrite(req, body.environment, () => service(req).updateStoreCategory({ ...body, parentExternalId: body.parentExternalId ?? null, id: String(req.params.id), actorId, correlationId: correlation() }))
  const medusaSync = await triggerMedusaSync(req, body.environment, actorId)
  res.json({ category, medusaSync })
}
