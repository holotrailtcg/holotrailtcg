import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { retryPulseSnapshotMatchingWorkflow } from "../../../../../../../workflows/trading-card-inventory/retry-pulse-snapshot-matching"
import {
  adminActor, idParamsSchema, parseAdminInput, retryMatchingBodySchema, safeAdminRead, safeAdminWrite, tradingCardInventoryService,
} from "../../../shared"

/**
 * Stage 5B.1 Slice 3: re-runs matching for an already-persisted snapshot via
 * the dedicated, file-free `retryPulseSnapshotMatchingWorkflow` — never the
 * upload workflow with placeholder file values. The existence check below
 * uses `getSnapshotImportSummary` (an explicit `MedusaError.Types.NOT_FOUND`
 * check) rather than letting the workflow's own generated-repository
 * `retrieveInventorySnapshot` lookup surface a missing snapshot — that
 * lookup throws a plain, untyped `Error`, which cannot be mapped to a safe
 * 404 by the route layer.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(retryMatchingBodySchema, req.body ?? {})
  await safeAdminRead(() => tradingCardInventoryService(req).getSnapshotImportSummary(id))

  const { result } = await safeAdminWrite(() => retryPulseSnapshotMatchingWorkflow(req.scope).run({
    input: { actor: adminActor(req), source: "MANUAL", snapshotId: id, reason: body.reason },
  }))

  switch (result.kind) {
    case "IMPORTED":
      res.status(200).json(result)
      return
    case "NO_USABLE_ROWS":
      res.status(422).json(result)
      return
    default:
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The retry could not be completed")
  }
}
