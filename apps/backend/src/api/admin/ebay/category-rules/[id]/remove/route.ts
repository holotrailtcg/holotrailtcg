import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { adminActor, categoryWrite, correlation, idParamsSchema, parseAdminInput, environmentSchema, service } from "../../shared"

const removeSchema = z.object({ environment: environmentSchema }).strict()

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(removeSchema, req.body ?? {})
  await categoryWrite(req, () =>
    service(req).removeCategoryAssignmentRule({ environment: body.environment, id, actorId: adminActor(req), correlationId: correlation() }),
  )
  res.status(200).json({ removed: true })
}
