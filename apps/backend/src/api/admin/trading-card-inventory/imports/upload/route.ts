import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { importPulseCsvSnapshotWorkflow } from "../../../../../workflows/trading-card-inventory/import-pulse-csv-snapshot"
import { adminActor, parseAdminInput, safeAdminWrite, uploadCsvBodySchema } from "../shared"

/**
 * Stage 5B.1 Slice 3: the only route that begins a Pulse import. It
 * validates the multipart request shape and hands the buffer straight to
 * `importPulseCsvSnapshotWorkflow` — every content/business rule (file
 * validation, source resolution/creation, matching, reconciliation) lives in
 * that already-tested workflow, never here. A new inventory source is only
 * ever created as a side effect of this same request (Path B); there is no
 * separate pre-create-source step in this flow.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(uploadCsvBodySchema, req.body)
  const file = req.file
  if (!file) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "A CSV file is required")
  }

  const { result } = await safeAdminWrite(() => importPulseCsvSnapshotWorkflow(req.scope).run({
    input: {
      actor: adminActor(req), source: "MANUAL",
      fileBuffer: file.buffer, originalFilename: file.originalname, mimeType: file.mimetype,
      inventorySourceId: body.inventorySourceId,
      newSourceDisplayName: body.newSourceDisplayName, newSourceProvider: body.newSourceProvider,
      newSourceLanguage: body.newSourceLanguage ?? null, newSourceDefaultCurrencyCode: body.newSourceDefaultCurrencyCode ?? null,
      previousApprovedSnapshotId: body.previousApprovedSnapshotId ?? null, reason: body.reason,
      requiresSeparateListingDefault: body.requiresSeparateListingDefault,
    },
  }))

  switch (result.kind) {
    case "IMPORTED":
      res.status(201).json(result)
      return
    case "DUPLICATE":
      res.status(200).json(result)
      return
    case "VALIDATION_FAILED":
      res.status(422).json(result)
      return
    case "NO_USABLE_ROWS":
      res.status(422).json(result)
      return
    case "SOURCE_ARCHIVED":
      res.status(409).json(result)
      return
    default:
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The import could not be completed")
  }
}
