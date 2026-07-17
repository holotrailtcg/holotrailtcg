import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { applyInventoryProposalsWorkflow } from "../../../../../../workflows/trading-card-inventory/apply-inventory-proposals"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite, tradingCardInventoryService } from "../../../shared"

/**
 * Single apply. Always 200 when the request itself is valid — Phase A
 * outcomes other than a clean APPLIED (STALE_BASELINE, INVALID_STATE,
 * OUT_OF_SCOPE) and a failed Medusa sync are reported in the body, not the
 * HTTP status: the local, authoritative stock movement already succeeded or
 * failed on its own terms, independent of Medusa reachability.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  await safeAdminRead(() => tradingCardInventoryService(req).retrieveInventoryProposal(id))

  const { result } = await safeAdminWrite(() => applyInventoryProposalsWorkflow(req.scope).run({
    input: { actor: adminActor(req), source: "MANUAL", ids: [id] },
  }))
  res.status(200).json({ result: result.results[0] })
}
