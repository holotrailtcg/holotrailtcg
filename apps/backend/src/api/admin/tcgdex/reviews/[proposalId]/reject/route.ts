import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proposalIdParamsSchema, rejectBodySchema } from "../../../../../../modules/trading-cards/tcgdex/admin-review"
import { adminActor, parseAdminInput, safeAdminWrite, tradingCardsService } from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { proposalId } = parseAdminInput(proposalIdParamsSchema, req.params)
  const { reason } = parseAdminInput(rejectBodySchema, req.body ?? {})
  const service = tradingCardsService(req)
  await safeAdminWrite(() => service.rejectEnrichmentProposal({
    actor: adminActor(req), source: "MANUAL", reason, proposalId,
  }))
  const result = await service.retrieveTcgdexAdminReview(proposalId)
  res.status(200).json(result)
}
