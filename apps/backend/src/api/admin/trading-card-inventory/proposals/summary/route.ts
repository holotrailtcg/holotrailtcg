import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseAdminInput, proposalSummaryQuerySchema, safeAdminRead, tradingCardInventoryService } from "../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { inventorySnapshotId } = parseAdminInput(proposalSummaryQuerySchema, req.query)
  const summary = await safeAdminRead(() => tradingCardInventoryService(req).getProposalSummary(inventorySnapshotId))
  res.status(200).json(summary)
}
