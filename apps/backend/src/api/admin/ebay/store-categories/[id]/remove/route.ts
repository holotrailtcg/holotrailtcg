import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { removeSchema, service, parseAdminInput, adminActor, categoryWrite, correlation, triggerMedusaSync } from "../../shared"
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(removeSchema, req.body ?? {})
  const id = String(req.params.id)
  const actorId = adminActor(req)
  const removal = await categoryWrite(req, body.environment, () => service(req).removeStoreCategory({ environment: body.environment, id, reason: body.reason, actorId, correlationId: correlation() }))
  // Removal never deletes the linked Medusa category — a sync pass is still run so any freshly-orphaned
  // subtree that was never synced doesn't linger un-reconciled, but this is otherwise a no-op on Medusa's side.
  const medusaSync = await triggerMedusaSync(req, body.environment, actorId)
  res.json({ ...removal, medusaSync })
}
