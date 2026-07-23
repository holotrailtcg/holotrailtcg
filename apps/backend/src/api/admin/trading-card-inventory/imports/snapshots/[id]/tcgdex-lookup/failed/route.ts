import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseProductId } from "../../../../../../../../modules/trading-card-inventory/pulse/product-id"
import { resolveSnapshotTcgdexCandidates } from "../../../../../../../../workflows/trading-card-inventory/process-tcgdex-lookup-batch"
import { idParamsSchema, parseAdminInput, safeAdminRead, tradingCardInventoryService, tradingCardsService } from "../../../../shared"

/**
 * Stage 1: failed (NO_MATCH / UNRESOLVED_SET / IDENTITY_MISMATCH) TCGdex
 * lookup candidates relevant to this snapshot's still-unmatched rows, each
 * with the last-attempted outcome and how many rows it affects — this is
 * the counterpart to `candidates/route.ts` (which only lists *successful*
 * matches awaiting review). A row here has a manual Retry action
 * (`tcgdex-lookup/retry`); `process-tcgdex-lookup-batch` will never
 * re-attempt these on its own.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const inventory = tradingCardInventoryService(req)
  const cards = tradingCardsService(req)

  const { language, uniqueCandidates, tcgdexSetIdBySetCode } = await safeAdminRead(() => resolveSnapshotTcgdexCandidates(inventory, cards, id))
  if (!language || uniqueCandidates.length === 0) {
    res.status(200).json({ failed: [] })
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

  const existing = await safeAdminRead(() => cards.listTcgdexLookupCandidates({ provider: "PULSE" as never, language, keys: uniqueCandidates }))
  const failed = existing
    .filter((row) => row.match_outcome !== "MATCHED")
    .map((row) => ({
      id: row.id,
      matchOutcome: row.match_outcome,
      tcgdexSetId: row.tcgdex_set_id,
      cardNumber: row.card_number,
      updatedAt: row.updated_at,
      rowCount: rowCountByKey.get(`${row.tcgdex_set_id}::${row.card_number}`) ?? 0,
    }))

  res.status(200).json({ failed })
}
