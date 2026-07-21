import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminActor, categoryWrite, correlation, environmentSchema, parseAdminInput, ruleBodySchema, service } from "./shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const environment = parseAdminInput(environmentSchema, req.query.environment)
  res.json({ rules: await service(req).listCategoryAssignmentRules(environment) })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(ruleBodySchema, req.body ?? {})
  const rule = await categoryWrite(req, () =>
    service(req).createCategoryAssignmentRule({ ...body, actorId: adminActor(req), correlationId: correlation() }),
  )
  res.status(201).json({ rule })
}
