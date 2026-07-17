import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { applyInventoryProposalsWorkflow } from "../../../../../workflows/trading-card-inventory/apply-inventory-proposals"
import { adminActor, parseAdminInput, proposalBulkApplyBodySchema, safeAdminWrite } from "../../shared"

/**
 * Bulk apply, per-item partial success: one stale/invalid proposal never
 * blocks the others. 200 whenever the request itself was valid; per-item
 * outcomes (including Medusa sync failures) live in `results`.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(proposalBulkApplyBodySchema, req.body ?? {})

  const { result } = await safeAdminWrite(() => applyInventoryProposalsWorkflow(req.scope).run({
    input: { actor: adminActor(req), source: "MANUAL", ids: body.ids },
  }))
  res.status(200).json({ results: result.results })
}
