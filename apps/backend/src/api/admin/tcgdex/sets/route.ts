import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { resolveTcgDexAdminClient } from "../dependencies"
import { CARD_LANGUAGE } from "../../../../modules/trading-cards/types"
import { parseAdminInput, safeAdminRead } from "../shared"

const querySchema = z.object({ language: z.enum(Object.values(CARD_LANGUAGE) as [string, ...string[]]) }).strict()

/**
 * Stage 1 alternative-match search, step 1: every TCGdex set for a
 * language, so a reviewer can find the right set before searching within
 * it for a specific card.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(querySchema, req.query)
  const client = resolveTcgDexAdminClient(req.scope)
  const sets = await safeAdminRead(() => client.listSets(query.language as never))
  res.status(200).json({ sets })
}
