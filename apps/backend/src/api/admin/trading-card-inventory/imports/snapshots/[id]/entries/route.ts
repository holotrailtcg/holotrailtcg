import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CardLanguage } from "../../../../../../../modules/trading-cards/types"
import {
  attachCardIdentities, attachTcgdexCandidates, idParamsSchema, parseAdminInput, safeAdminRead, snapshotEntriesQuerySchema,
  toSafeSnapshotEntryDto, tradingCardInventoryService,
} from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const query = parseAdminInput(snapshotEntriesQuerySchema, req.query)
  const filters: Record<string, unknown> = {}
  filters.sortBy = query.sortBy
  filters.sortDirection = query.sortDirection
  if (query.outcome) filters.outcome = query.outcome
  if (query.reviewStatus) filters.reviewStatus = query.reviewStatus
  if (query.finishCandidate) filters.finishCandidate = query.finishCandidate
  if (query.specialTreatmentCandidate) filters.specialTreatmentCandidate = query.specialTreatmentCandidate
  if (query.rarityCandidate) filters.rarityCandidate = query.rarityCandidate
  if (query.duplicateReferenceOnly) filters.duplicateReferenceOnly = true
  if (query.snapshotEntryId) filters.snapshotEntryId = query.snapshotEntryId
  if (query.providerReference) filters.providerReference = query.providerReference

  const inventory = tradingCardInventoryService(req)
  const { rows, count } = await safeAdminRead(() =>
    inventory.listSnapshotEntriesForAdmin(id, filters, { limit: query.limit, offset: query.offset })
  )
  const summary = await safeAdminRead(() => inventory.getSnapshotImportSummary(id))
  const language = (summary.inventorySourceLanguage as CardLanguage | null) ?? null

  let entries = await attachCardIdentities(req, rows.map((row: Record<string, unknown>) => toSafeSnapshotEntryDto(row)))
  entries = await attachTcgdexCandidates(req, entries, language)
  res.status(200).json({ entries, count, limit: query.limit, offset: query.offset })
}
