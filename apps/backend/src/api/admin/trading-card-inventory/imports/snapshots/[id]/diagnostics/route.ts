import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  idParamsSchema, parseAdminInput, safeAdminRead, snapshotDiagnosticsQuerySchema, toSafeDiagnosticDto, tradingCardInventoryService,
} from "../../../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const query = parseAdminInput(snapshotDiagnosticsQuerySchema, req.query)
  const filters: Record<string, unknown> = {}
  if (query.severity) filters.severity = query.severity
  if (query.snapshotEntryId) filters.snapshotEntryId = query.snapshotEntryId

  const { rows, count } = await safeAdminRead(() =>
    tradingCardInventoryService(req).listSnapshotEntryDiagnostics(id, filters, { limit: query.limit, offset: query.offset })
  )
  res.status(200).json({
    diagnostics: rows.map((row: Record<string, unknown>) => toSafeDiagnosticDto(row)),
    count, limit: query.limit, offset: query.offset,
  })
}
