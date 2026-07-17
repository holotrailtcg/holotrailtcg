import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { reconcileInventorySnapshotWorkflow } from "../../../../../../../workflows/trading-card-inventory/reconcile-inventory-snapshot"
import {
  adminActor, idParamsSchema, parseAdminInput, reconcileBodySchema, safeAdminRead, safeAdminWrite, tradingCardInventoryService,
} from "../../../shared"

/**
 * Stage 5B.1 Slice 3: manually (re-)triggers reconciliation for a snapshot
 * that reached VALIDATED but was never reconciled, or whose reconciliation
 * didn't complete. Baseline validation is not duplicated here — the
 * existing `reconcileInventorySnapshot` service method already requires
 * `previousApprovedSnapshotId` (when given) to reference an approved,
 * non-rejected/failed snapshot for the same source, and already rejects any
 * snapshot that isn't `VALIDATED` (or, idempotently, `PENDING_REVIEW` with a
 * matching baseline) before writing anything.
 *
 * The existence check uses `getSnapshotImportSummary` (an explicit
 * `MedusaError.Types.NOT_FOUND` check) rather than the generated-repository
 * `retrieveInventorySnapshot` lookup, which throws a plain, untyped `Error`
 * that cannot be mapped to a safe 404 by the route layer.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(reconcileBodySchema, req.body ?? {})
  const service = tradingCardInventoryService(req)
  const summary = await safeAdminRead(() => service.getSnapshotImportSummary(id))

  const { result } = await safeAdminWrite(() => reconcileInventorySnapshotWorkflow(req.scope).run({
    input: {
      actor: adminActor(req), source: "MANUAL", reason: body.reason,
      inventorySourceId: summary.inventorySourceId as string, snapshotId: id,
      previousApprovedSnapshotId: body.previousApprovedSnapshotId ?? null,
    },
  }))
  res.status(200).json({ summary: result })
}
