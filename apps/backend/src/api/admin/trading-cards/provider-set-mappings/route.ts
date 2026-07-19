import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveTcgDexAdminClient } from "../../tcgdex/dependencies"
import { TcgDexError, type TcgDexLanguage } from "../../../../modules/trading-cards/tcgdex"
import { createProviderSetMappingBodySchema, parseAdminInput, safeAdminWrite, tradingCardsService } from "../shared"

/**
 * Confirms a provider set code → TCGdex set id mapping. Always re-verifies
 * the id against a live TCGdex lookup first — never trusts a client-supplied
 * id on faith, since a wrong mapping here would misdirect every future
 * automatic match for that set.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(createProviderSetMappingBodySchema, req.body ?? {})
  const client = resolveTcgDexAdminClient(req.scope)

  let sets: Array<{ id: string; name: string }>
  try {
    sets = await client.listSets(body.language as TcgDexLanguage)
  } catch (error) {
    if (error instanceof TcgDexError) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "TCGdex could not be reached to verify this set. Please try again.")
    }
    throw error
  }
  const matched = sets.find((set) => set.id.toLowerCase() === body.tcgdexSetId.toLowerCase())
  if (!matched) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "This TCGdex set id was not found for the given language.")
  }

  let setDetail
  try {
    setDetail = await client.getSetById(body.language as TcgDexLanguage, matched.id)
  } catch (error) {
    if (error instanceof TcgDexError) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "TCGdex could not be reached to verify this set's series. Please try again.")
    }
    throw error
  }

  const mapping = await safeAdminWrite(() => tradingCardsService(req).createProviderSetMapping({
    provider: body.provider as never, game: body.game as never, language: body.language as never,
    providerSetCode: body.providerSetCode, tcgdexSetId: setDetail.id, tcgdexSetName: setDetail.name,
    tcgdexSeriesId: setDetail.serie.id, tcgdexSeriesName: setDetail.serie.name,
  }))

  res.status(201).json({ mapping })
}
