import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveR2Config } from "../../../../../../../modules/trading-cards/images/r2-config"
import { loadInventorySnapshotProgress } from "../../../../../../../workflows/trading-card-inventory/advance-snapshot-progress"
import { idParamsSchema, parseAdminInput, safeAdminRead, tradingCardInventoryService, tradingCardsService } from "../../../shared"

/**
 * Whether every card this snapshot has actually matched already has a real
 * photograph, and there are no rows left unmatched. Gates the Admin "Next"
 * button between step 2 (sync/match, which is also where missing cards get
 * created) and step 4 (approve) — approving stock changes for a card with no
 * photo yet, or for a row that never got a card, defeats the point of a
 * dedicated "assign images" step.
 */
async function loadImageReadiness(req: AuthenticatedMedusaRequest, snapshotId: string, outstandingMatches: number) {
  const variantIds = await tradingCardInventoryService(req).listDistinctMatchedVariantIds(snapshotId)
  if (variantIds.length === 0) return { ready: outstandingMatches === 0, totalMatchedCards: 0, cardsWithPhoto: 0 }
  const config = resolveR2Config()
  const thumbnails = await tradingCardsService(req).listThumbnailsForVariants({
    variantIds, publicBaseUrl: config.enabled ? config.publicBaseUrl : null,
  })
  const cardsWithPhoto = Object.values(thumbnails).filter((thumbnail) => thumbnail.source === "PHOTO").length
  return { ready: outstandingMatches === 0 && cardsWithPhoto === variantIds.length, totalMatchedCards: variantIds.length, cardsWithPhoto }
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const summary = await safeAdminRead(() => tradingCardInventoryService(req).getSnapshotImportSummary(id))
  // Computed live on every read, never a stored field, so it can never drift from actual proposal/holding state.
  const { progress } = await safeAdminRead(() => loadInventorySnapshotProgress(req.scope, id))
  const outstandingMatches = ["UNMATCHED", "AMBIGUOUS", "REVIEW_REQUIRED"]
    .reduce((sum, status) => sum + (summary.byMatchingStatus[status] ?? 0), 0)
  const imageReadiness = await safeAdminRead(() => loadImageReadiness(req, id, outstandingMatches))
  res.status(200).json({ summary, progress, imageReadiness })
}
