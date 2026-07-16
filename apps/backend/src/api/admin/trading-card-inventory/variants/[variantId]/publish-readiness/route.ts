import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPublishReadiness } from "../../../../../../modules/trading-card-inventory/readiness/get-publish-readiness"
import { parseAdminInput, safeAdminRead, variantIdParamsSchema } from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { variantId } = parseAdminInput(variantIdParamsSchema, req.params)
  const result = await safeAdminRead(() => getPublishReadiness(req.scope, variantId))
  res.status(200).json(result)
}
