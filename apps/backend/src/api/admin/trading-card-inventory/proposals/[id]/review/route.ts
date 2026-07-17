import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { reviewInventoryProposalsWorkflow } from "../../../../../../workflows/trading-card-inventory/review-inventory-proposals"
import {
  adminActor, idParamsSchema, parseAdminInput, proposalReviewBodySchema, safeAdminRead, safeAdminWrite,
  toSafeInventoryProposalDto, tradingCardInventoryService,
} from "../../../shared"

/** Single approve/reject. Reviewer identity is always the authenticated admin user, never read from the body. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(proposalReviewBodySchema, req.body ?? {})
  // Existence check up front so an unknown id maps to a clean 404 rather than surfacing through the bulk all-or-nothing path.
  await safeAdminRead(() => tradingCardInventoryService(req).retrieveInventoryProposal(id))

  const { result } = await safeAdminWrite(() => reviewInventoryProposalsWorkflow(req.scope).run({
    input: {
      actor: adminActor(req), source: "MANUAL", ids: [id],
      targetStatus: body.targetStatus as "APPROVED" | "REJECTED", rejectionReason: body.rejectionReason ?? null, reviewNote: body.reviewNote ?? null,
    },
  }))
  res.status(200).json({ proposal: toSafeInventoryProposalDto(result[0] as Record<string, unknown>) })
}
