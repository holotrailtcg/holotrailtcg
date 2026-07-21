import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { syncStoreCategoriesToMedusaWorkflow } from "../../../../../workflows/ebay-integration/sync-store-categories-to-medusa"
import { adminActor, assertTrustedAdminOrigin, correlation, environmentSchema, parseAdminInput } from "../shared"

const bodySchema = z.object({ environment: environmentSchema }).strict()

/** Explicit Admin action: "Sync categories to Medusa". Idempotent full reconciliation of every active local Store category. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(bodySchema, req.body ?? {})
  assertTrustedAdminOrigin(req)
  const { result } = await syncStoreCategoriesToMedusaWorkflow(req.scope).run({
    input: { environment: body.environment, actorId: adminActor(req), correlationId: correlation() },
  })
  res.status(200).json({ summary: result })
}
