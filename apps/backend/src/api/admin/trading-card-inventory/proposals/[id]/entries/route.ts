import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { idParamsSchema, parseAdminInput, safeAdminRead, tradingCardInventoryService } from "../../../shared"

/**
 * Stage 1: the physical source rows currently composing this proposal's
 * group — powers the split dialog (choose which rows to move out) and the
 * separate-listing override dialog (choose which rows to flag).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const rows = await safeAdminRead(() => tradingCardInventoryService(req).listCurrentGroupEntries(id))
  res.status(200).json({
    entries: rows.map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      providerReference: row.provider_reference,
      quantity: row.quantity,
      conditionCandidate: row.condition_candidate,
      finishCandidate: row.finish_candidate,
      specialTreatmentCandidate: row.special_treatment_candidate,
      requiresSeparateListing: row.requires_separate_listing_override ?? row.requires_separate_listing,
    })),
  })
}
