import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { reviewInventoryProposalsWorkflow } from "../../../../../workflows/trading-card-inventory/review-inventory-proposals"
import {
  adminActor, parseAdminInput, proposalBulkReviewBodySchema, safeAdminWrite, toSafeInventoryProposalDto,
} from "../../shared"

/** Bulk approve/reject, all-or-nothing: any ineligible id in the batch aborts the whole request. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(proposalBulkReviewBodySchema, req.body ?? {})

  const { result } = await safeAdminWrite(() => reviewInventoryProposalsWorkflow(req.scope).run({
    input: {
      actor: adminActor(req), source: "MANUAL", ids: body.ids,
      targetStatus: body.targetStatus as "APPROVED" | "REJECTED", rejectionReason: body.rejectionReason ?? null, reviewNote: body.reviewNote ?? null,
    },
  }))
  res.status(200).json({ proposals: (result as Record<string, unknown>[]).map((row) => toSafeInventoryProposalDto(row)) })
}
