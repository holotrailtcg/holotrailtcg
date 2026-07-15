import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { tradingCardIdParamsSchema } from "../../../../../../modules/trading-cards/tcgdex/admin-review"
import { TCGDEX_MATCH_CODE } from "../../../../../../modules/trading-cards/tcgdex"
import { resolveTcgDexAdminClient } from "../../../dependencies"
import { adminActor, parseAdminInput, safeAdminWrite, tradingCardsService } from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { tradingCardId } = parseAdminInput(tradingCardIdParamsSchema, req.params)
  const service = tradingCardsService(req)
  const client = resolveTcgDexAdminClient(req.scope)

  const outcome = await safeAdminWrite(() => service.retryTcgdexEnrichmentMatch({
    actor: adminActor(req), source: "TCGDEX", tradingCardId, client,
  }))

  const result = outcome.code === TCGDEX_MATCH_CODE.MATCHED
    ? { outcome: outcome.code, review: (await service.retrieveTcgdexAdminReview(outcome.id)).review }
    : { outcome: outcome.code, attempt: await service.retrieveTcgdexAdminAttempt(outcome.id) }

  res.status(200).json(result)
}
