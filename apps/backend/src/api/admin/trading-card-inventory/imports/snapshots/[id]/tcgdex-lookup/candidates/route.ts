import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseProductId } from "../../../../../../../../modules/trading-card-inventory/pulse/product-id"
import { resolveSnapshotTcgdexCandidates } from "../../../../../../../../workflows/trading-card-inventory/process-tcgdex-lookup-batch"
import { idParamsSchema, parseAdminInput, safeAdminRead, tradingCardInventoryService, tradingCardsService } from "../../../../shared"

/**
 * TCGdex matches ready for bulk review on the Sync step — every
 * `MATCHED`+`PENDING` lookup candidate relevant to this snapshot's
 * still-unmatched rows, with how many rows each would resolve.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const inventory = tradingCardInventoryService(req)
  const cards = tradingCardsService(req)

  const { language, uniqueCandidates, tcgdexSetIdBySetCode } = await safeAdminRead(() => resolveSnapshotTcgdexCandidates(inventory, cards, id))
  if (!language || uniqueCandidates.length === 0) {
    res.status(200).json({ candidates: [] })
    return
  }

  const unmatchedEntries = await safeAdminRead(() => inventory.listUnmatchedSnapshotEntriesForAdmin(id))
  const rowCountByKey = new Map<string, number>()
  for (const entry of unmatchedEntries) {
    const parsed = parseProductId(entry.provider_reference as string)
    if (!parsed.setCodeCandidate || !parsed.cardNumberCandidate) continue
    const tcgdexSetId = tcgdexSetIdBySetCode.get(parsed.setCodeCandidate)
    if (!tcgdexSetId) continue
    const cardNumber = parsed.cardNumberCandidate.split("/")[0].trim()
    const key = `${tcgdexSetId}::${cardNumber}`
    rowCountByKey.set(key, (rowCountByKey.get(key) ?? 0) + 1)
  }

  const candidates: Array<Record<string, unknown>> = []
  for (const candidateKey of uniqueCandidates) {
    const row = await safeAdminRead(() => cards.findTcgdexLookupCandidate({
      provider: "PULSE" as never, language, tcgdexSetId: candidateKey.tcgdexSetId, cardNumber: candidateKey.cardNumber,
    }))
    if (!row || row.match_outcome !== "MATCHED" || row.review_status !== "PENDING") continue
    const enrichment = row.enrichment as { name: string; referenceArtworkUrl?: string; providerRarity?: string; illustrator?: string } | null
    if (!enrichment) continue
    candidates.push({
      id: row.id,
      name: enrichment.name,
      referenceArtworkUrl: enrichment.referenceArtworkUrl ?? null,
      providerRarity: enrichment.providerRarity ?? null,
      illustrator: enrichment.illustrator ?? null,
      tcgdexSetId: row.tcgdex_set_id,
      cardNumber: row.card_number,
      rowCount: rowCountByKey.get(`${candidateKey.tcgdexSetId}::${candidateKey.cardNumber}`) ?? 0,
    })
  }

  res.status(200).json({ candidates })
}
