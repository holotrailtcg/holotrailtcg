import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseProductId } from "../../../../../modules/trading-card-inventory/pulse/product-id"
import { CARD_GAME, EXTERNAL_PROVIDER, type CardLanguage } from "../../../../../modules/trading-cards/types"
import { tradingCardInventoryService } from "../../../trading-card-inventory/shared"
import { parseAdminInput, safeAdminRead, tradingCardsService, unmappedSetCodesQuerySchema } from "../../shared"

/**
 * Distinct set codes referenced by a snapshot's still-unmatched rows that
 * have no confirmed TCGdex mapping yet — backs the "N sets need mapping"
 * banner on the Sync step. Matched rows are never included: their set is
 * already resolved (or was never provider-code-driven, e.g. a manually
 * created card), so re-checking it here would only add noise.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { snapshotId } = parseAdminInput(unmappedSetCodesQuerySchema, req.query)
  const inventory = tradingCardInventoryService(req)
  const cards = tradingCardsService(req)

  const summary = await safeAdminRead(() => inventory.getSnapshotImportSummary(snapshotId))
  const language = (summary.inventorySourceLanguage as CardLanguage | null) ?? null
  if (!language) {
    res.status(200).json({ language: null, unmappedSetCodes: [] })
    return
  }

  const providerReferences = await safeAdminRead(() => inventory.listDistinctUnmatchedProviderReferences(snapshotId))
  const setCodes = [...new Set(
    providerReferences.map((reference) => parseProductId(reference).setCodeCandidate).filter((code): code is string => Boolean(code))
  )]

  const unmappedSetCodes: string[] = []
  for (const providerSetCode of setCodes) {
    const mapping = await safeAdminRead(() => cards.findProviderSetMapping({
      provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON, language, providerSetCode,
    }))
    if (!mapping) unmappedSetCodes.push(providerSetCode)
  }

  res.status(200).json({ language, unmappedSetCodes })
}
