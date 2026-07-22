import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cardSetsQuerySchema, parseAdminInput, safeAdminRead, tradingCardsService } from "../shared"

/**
 * Lists the card sets Holo Trail already knows about (imported via Pulse or
 * created manually) — used to populate Set code / Set name pickers, such as
 * the eBay category assignment rules. Not the full TCGdex catalogue: only
 * sets this store actually stocks, which is what a rule needs to target.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(cardSetsQuerySchema, req.query)
  const sets = await safeAdminRead(() =>
    tradingCardsService(req).listCardSets(
      query.language ? { language: query.language } : {},
      { order: { display_name: "ASC" } },
    ),
  )
  res.status(200).json({
    sets: sets.map((set) => ({
      id: set.id,
      game: set.game,
      language: set.language,
      displayName: set.display_name,
      providerSetCode: set.provider_set_code,
    })),
  })
}
