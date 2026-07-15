import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proposalIdParamsSchema } from "../../../../../../modules/trading-cards/tcgdex/admin-review"
import { adminActor, parseAdminInput, safeAdminWrite, tradingCardsService } from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { proposalId } = parseAdminInput(proposalIdParamsSchema, req.params)
  const service = tradingCardsService(req)
  await safeAdminWrite(() => service.applyApprovedEnrichmentProposal({
    actor: adminActor(req), source: "MANUAL", proposalId,
  }))
  const result = await service.retrieveTcgdexAdminReview(proposalId)
  res.status(200).json(result)
}
