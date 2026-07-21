import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { environmentSchema, createCategorySchema, service, parseAdminInput, adminActor, categoryWrite, correlation, triggerMedusaSync } from "./shared"
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) { const environment = parseAdminInput(environmentSchema, req.query.environment); res.json(await service(req).listStoreCategories(environment)) }
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(createCategorySchema, req.body ?? {})
  const actorId = adminActor(req)
  const category = await categoryWrite(req, body.environment, () => service(req).createStoreCategory({ ...body, parentExternalId: body.parentExternalId ?? null, actorId, correlationId: correlation() }))
  const medusaSync = await triggerMedusaSync(req, body.environment, actorId)
  res.status(201).json({ category, medusaSync })
}
