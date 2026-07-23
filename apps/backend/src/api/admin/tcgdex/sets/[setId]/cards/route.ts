import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { resolveTcgDexAdminClient } from "../../../dependencies"
import { CARD_LANGUAGE } from "../../../../../../modules/trading-cards/types"
import { tradingCardsService, parseAdminInput, safeAdminRead } from "../../../shared"

const paramsSchema = z.object({ setId: z.string().trim().min(1) })
const querySchema = z.object({
  language: z.enum(Object.values(CARD_LANGUAGE) as [string, ...string[]]),
  query: z.string().trim().max(128).optional(),
}).strict()

/**
 * Stage 1 alternative-match search, step 2: cards within one TCGdex set,
 * optionally filtered by name or exact local card number — see
 * `tcgdex/search.ts` for why this reuses the existing verified
 * `getSetById` call instead of an unverified free-text search endpoint.
 * Returns enough identifying data (name, artwork, local number, set name)
 * to distinguish visually similar cards.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { setId } = parseAdminInput(paramsSchema, req.params)
  const query = parseAdminInput(querySchema, req.query)
  const client = resolveTcgDexAdminClient(req.scope)
  const candidates = await safeAdminRead(() => tradingCardsService(req).searchTcgdexCardsInSet({
    language: query.language as never, tcgdexSetId: setId, query: query.query ?? null, client,
  }))
  res.status(200).json({ candidates })
}
