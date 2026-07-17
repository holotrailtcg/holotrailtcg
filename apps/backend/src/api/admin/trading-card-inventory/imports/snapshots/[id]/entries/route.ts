import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  idParamsSchema, parseAdminInput, safeAdminRead, snapshotEntriesQuerySchema, toSafeSnapshotEntryDto, tradingCardInventoryService,
} from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const query = parseAdminInput(snapshotEntriesQuerySchema, req.query)
  const filters: Record<string, unknown> = {}
  if (query.outcome) filters.outcome = query.outcome
  if (query.matchingStatus) filters.matchingStatus = query.matchingStatus
  if (query.finishCandidate) filters.finishCandidate = query.finishCandidate
  if (query.specialTreatmentCandidate) filters.specialTreatmentCandidate = query.specialTreatmentCandidate
  if (query.rarityCandidate) filters.rarityCandidate = query.rarityCandidate
  if (query.duplicateReferenceOnly) filters.duplicateReferenceOnly = true

  const { rows, count } = await safeAdminRead(() =>
    tradingCardInventoryService(req).listSnapshotEntriesForAdmin(id, filters, { limit: query.limit, offset: query.offset })
  )
  res.status(200).json({
    entries: rows.map((row: Record<string, unknown>) => toSafeSnapshotEntryDto(row)),
    count, limit: query.limit, offset: query.offset,
  })
}
