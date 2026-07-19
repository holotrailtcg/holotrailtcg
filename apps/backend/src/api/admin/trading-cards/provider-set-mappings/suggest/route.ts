import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveTcgDexAdminClient } from "../../../tcgdex/dependencies"
import { candidateTcgdexSetIds, TcgDexError, type TcgDexLanguage } from "../../../../../modules/trading-cards/tcgdex"
import { parseAdminInput, safeAdminRead, suggestSetMappingQuerySchema } from "../../shared"

/**
 * Best-guess TCGdex set id candidates for a provider set code, each
 * verified against a live TCGdex set list before being offered — never a
 * guarantee, just a pre-fill for the confirmation form. Returns every set
 * that name-or-id matches the raw code too, so a reviewer who knows the
 * candidates are wrong can still browse and pick the right one manually.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { providerSetCode, language } = parseAdminInput(suggestSetMappingQuerySchema, req.query)
  const client = resolveTcgDexAdminClient(req.scope)

  let allSets: Array<{ id: string; name: string }>
  try {
    allSets = await client.listSets(language as TcgDexLanguage)
  } catch (error) {
    if (error instanceof TcgDexError) {
      res.status(200).json({ candidates: [], sets: [], error: error.code })
      return
    }
    throw error
  }

  const candidateIds = candidateTcgdexSetIds(providerSetCode, language as never)
  const candidates = candidateIds
    .map((candidateId) => allSets.find((set) => set.id.toLowerCase() === candidateId.toLowerCase()))
    .filter((set): set is { id: string; name: string } => Boolean(set))

  res.status(200).json({
    candidates,
    // Full set list too, so the confirmation form can offer a search/browse
    // fallback when no candidate matched.
    sets: allSets,
  })
}
