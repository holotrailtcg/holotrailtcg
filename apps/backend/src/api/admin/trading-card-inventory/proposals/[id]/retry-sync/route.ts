import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryInventoryProposalSyncWorkflow } from "../../../../../../workflows/trading-card-inventory/retry-inventory-proposal-sync"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite, toSafeInventoryProposalDto, tradingCardInventoryService } from "../../../shared"

/**
 * Retries Phase B (Medusa sync) only. 409 when there's nothing eligible to
 * retry (already synced, or a concurrent attempt holds a non-expired token)
 * — thrown as `MedusaError.Types.CONFLICT` inside the
 * workflow. 502 when the retry itself reaches Medusa but fails; 200 on a
 * successful sync.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  await safeAdminRead(() => tradingCardInventoryService(req).retrieveInventoryProposal(id))

  const { result } = await safeAdminWrite(() => retryInventoryProposalSyncWorkflow(req.scope).run({
    input: { actor: adminActor(req), source: "MANUAL", proposalId: id },
  }))
  const proposal = result as Record<string, unknown>
  const statusCode = proposal.medusa_sync_status === "FAILED" ? 502 : 200
  res.status(statusCode).json({ proposal: toSafeInventoryProposalDto(proposal) })
}
