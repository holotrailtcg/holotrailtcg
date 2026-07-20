import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { environmentSchema, parseAdminInput, service } from "../shared"

const auditQuerySchema = z.object({
  environment: environmentSchema,
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict()

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(auditQuerySchema, req.query)
  res.json(await service(req).listStoreCategoryAudits(query.environment, query.limit))
}
