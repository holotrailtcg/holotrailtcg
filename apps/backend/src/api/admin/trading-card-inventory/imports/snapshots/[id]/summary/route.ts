import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadInventorySnapshotProgress } from "../../../../../../../workflows/trading-card-inventory/advance-snapshot-progress"
import { idParamsSchema, parseAdminInput, safeAdminRead, tradingCardInventoryService } from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const summary = await safeAdminRead(() => tradingCardInventoryService(req).getSnapshotImportSummary(id))
  // Computed live on every read, never a stored field, so it can never drift from actual proposal/holding state.
  const { progress } = await safeAdminRead(() => loadInventorySnapshotProgress(req.scope, id))
  res.status(200).json({ summary, progress })
}
