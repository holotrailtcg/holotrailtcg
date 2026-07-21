import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EBAY_INTEGRATION_MODULE } from "../../../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../../../modules/ebay-integration/service"
import { adminActor, assertTrustedAdminOrigin, parseAdminInput } from "../connections/shared"
import { fallbackBodySchema, environmentSchema } from "../category-rules/shared"
import { randomUUID } from "node:crypto"

function service(req: AuthenticatedMedusaRequest) {
  return req.scope.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const environment = parseAdminInput(environmentSchema, req.query.environment)
  res.json(await service(req).getCategoryAssignmentSettings(environment))
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(fallbackBodySchema, req.body ?? {})
  assertTrustedAdminOrigin(req)
  const result = await service(req).setCategoryAssignmentFallback({
    environment: body.environment,
    fallbackStoreCategoryId: body.fallbackStoreCategoryId,
    actorId: adminActor(req),
    correlationId: randomUUID(),
  })
  res.status(200).json(result)
}
