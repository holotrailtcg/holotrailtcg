import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminActor, categoryWrite, correlation, idParamsSchema, parseAdminInput, ruleBodySchema, service } from "../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(ruleBodySchema, req.body ?? {})
  const rule = await categoryWrite(req, () =>
    service(req).updateCategoryAssignmentRule({ ...body, id, actorId: adminActor(req), correlationId: correlation() }),
  )
  res.status(200).json({ rule })
}
