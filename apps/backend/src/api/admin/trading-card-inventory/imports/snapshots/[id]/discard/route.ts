import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { discardInventorySnapshotWorkflow } from "../../../../../../../workflows/trading-card-inventory/discard-inventory-snapshot"
import {
  adminActor, discardSnapshotBodySchema, idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite,
  toSafeInventorySnapshotListItemDto, tradingCardInventoryService,
} from "../../../shared"

/** Manually removes a not-yet-applied snapshot from the working list. Blocked (by the transition table) once the snapshot has reached APPLIED/APPLYING. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(discardSnapshotBodySchema, req.body ?? {})
  await safeAdminRead(() => tradingCardInventoryService(req).retrieveInventorySnapshot(id))

  const snapshot = await safeAdminWrite(() => discardInventorySnapshotWorkflow(req.scope).run({
    input: { actor: adminActor(req), source: "MANUAL", reason: body.reason ?? null, id },
  }))
  res.status(200).json({ snapshot: toSafeInventorySnapshotListItemDto(snapshot.result as Record<string, unknown>) })
}
