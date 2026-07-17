import { createHash } from "node:crypto"
import { parse } from "csv-parse/sync"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { DuplicateSnapshotError, type ImportedSnapshotEntryInput } from "../../modules/trading-card-inventory/service"
import { INVENTORY_AUDIT_ACTION, INVENTORY_PROVIDER_REFERENCE_TYPE, INVENTORY_SNAPSHOT_STATUS, INVENTORY_SOURCE_STATUS } from "../../modules/trading-card-inventory/types"
import { decodeUtf8Strict, validateHeaders } from "../../modules/trading-card-inventory/pulse/csv-format"
import { parsePulseRow, type PulseCsvRecord } from "../../modules/trading-card-inventory/pulse/row-parser"
import {
  PULSE_FILE_LIMITS, PULSE_UPLOAD_FILENAME_SUFFIX, PULSE_UPLOAD_MIME_ALLOWLIST, type ParsedPulseRow,
} from "../../modules/trading-card-inventory/pulse/types"
import {
  collectWarnings, invokeReconciliation, matchAndPersistEntries, retryPulseSnapshotMatching, transitionSnapshotStatus,
} from "./pulse-import-shared"
import type { ImportPulseCsvSnapshotInput, ImportPulseCsvSnapshotResult, ImportSummary } from "./import-pulse-csv-snapshot-types"

export class ValidationFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ValidationFailedError"
  }
}

export class SourceArchivedError extends Error {
  constructor() {
    super("Inventory source is archived and cannot receive new imports")
    this.name = "SourceArchivedError"
  }
}

function toImportedSnapshotEntryInput(row: ParsedPulseRow): ImportedSnapshotEntryInput {
  return {
    rowNumber: row.rowNumber,
    outcome: row.outcome,
    providerReference: row.providerReference,
    providerReferenceType: INVENTORY_PROVIDER_REFERENCE_TYPE.PULSE_PRODUCT_ID,
    quantity: row.quantity,
    currencyCode: row.currencyCode,
    unitAcquisitionCost: row.unitAcquisitionCost,
    unitMarketPrice: row.unitMarketPrice,
    unitSellingPrice: row.unitSellingPrice,
    conditionSource: row.conditionSource,
    finishCandidate: row.finishCandidate,
    specialTreatmentCandidate: row.specialTreatmentCandidate,
    rarityCandidate: row.rarityCandidate,
    rarityRaw: row.rarityRaw,
    languageConflict: row.languageConflict,
    rawFields: row.rawFields,
    diagnostics: row.diagnostics.map((diagnostic) => ({
      rowNumber: diagnostic.rowNumber, phase: diagnostic.phase, code: diagnostic.code,
      severity: diagnostic.severity, fieldRef: diagnostic.fieldRef, message: diagnostic.message,
    })),
  }
}

interface ValidatedFile { contentHash: string; headers: string[]; dataRows: string[][] }

/** Pure, in-memory, no DB. Fatal failures here must never reach even a DRAFT row — they are pre-existence facts. */
function validatePulseFile(input: ImportPulseCsvSnapshotInput): ValidatedFile {
  if (input.fileBuffer.byteLength === 0) throw new ValidationFailedError("The uploaded file is empty")
  if (input.fileBuffer.byteLength > PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new ValidationFailedError("File exceeds the maximum allowed size")
  }
  if (!input.originalFilename.toLowerCase().endsWith(PULSE_UPLOAD_FILENAME_SUFFIX)) {
    throw new ValidationFailedError("Only .csv files are accepted")
  }
  if (!(PULSE_UPLOAD_MIME_ALLOWLIST as readonly string[]).includes(input.mimeType)) {
    throw new ValidationFailedError(`Unsupported file type: ${input.mimeType}`)
  }
  const contentHash = createHash("sha256").update(input.fileBuffer).digest("hex")
  let decodedText: string
  try {
    decodedText = decodeUtf8Strict(input.fileBuffer)
  } catch (error) {
    throw new ValidationFailedError(error instanceof Error ? error.message : "File could not be decoded as UTF-8")
  }
  let records: string[][]
  try {
    records = parse(decodedText, { skip_empty_lines: true, relax_column_count: true, bom: false }) as string[][]
  } catch {
    throw new ValidationFailedError("File could not be parsed as CSV")
  }
  if (records.length === 0) throw new ValidationFailedError("File has no header row")
  const headerResult = validateHeaders(records[0])
  if (!headerResult.ok) {
    const parts: string[] = []
    if (headerResult.missing.length) parts.push(`missing: ${headerResult.missing.join(", ")}`)
    if (headerResult.duplicate.length) parts.push(`duplicate: ${headerResult.duplicate.join(", ")}`)
    if (headerResult.unsupported.length) parts.push(`unsupported: ${headerResult.unsupported.join(", ")}`)
    throw new ValidationFailedError(`Invalid CSV headers (${parts.join("; ")})`)
  }
  const dataRows = records.slice(1)
  if (dataRows.length === 0) throw new ValidationFailedError("File has no data rows")
  if (dataRows.length > PULSE_FILE_LIMITS.MAX_ROWS) throw new ValidationFailedError("File exceeds the maximum allowed row count")
  return { contentHash, headers: headerResult.normalizedHeaders, dataRows }
}

async function resolveInventorySource(
  inventory: TradingCardInventoryModuleService,
  input: ImportPulseCsvSnapshotInput,
): Promise<{ inventorySourceId: string; sourceLanguage: string | null }> {
  if (input.inventorySourceId) {
    const source = await inventory.retrieveInventorySource(input.inventorySourceId).catch(() => null)
    if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
    if (source.status === INVENTORY_SOURCE_STATUS.ARCHIVED) throw new SourceArchivedError()
    return { inventorySourceId: source.id as string, sourceLanguage: (source.language as string | null) ?? null }
  }
  if (!input.newSourceDisplayName || !input.newSourceProvider) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Either inventorySourceId or newSourceDisplayName and newSourceProvider is required")
  }
  const { source } = await inventory.createOrGetInventorySource({
    actor: input.actor, source: input.source, reason: input.reason,
    displayName: input.newSourceDisplayName, provider: input.newSourceProvider,
    language: input.newSourceLanguage ?? null, defaultCurrencyCode: input.newSourceDefaultCurrencyCode ?? null,
  }).catch((error) => {
    if (error instanceof MedusaError && error.type === MedusaError.Types.NOT_ALLOWED) throw new SourceArchivedError()
    throw error
  })
  return { inventorySourceId: source.id as string, sourceLanguage: (source.language as string | null) ?? null }
}

async function createOrReturnDraftSnapshot(
  inventory: TradingCardInventoryModuleService,
  input: ImportPulseCsvSnapshotInput,
  inventorySourceId: string,
  contentHash: string,
): Promise<{ snapshotId: string; created: boolean }> {
  const existing = await inventory.findLiveSnapshotByContentHash({ inventorySourceId, contentHash })
  if (existing) {
    await inventory.recordImportLifecycleAudit({
      actor: input.actor, source: input.source, reason: input.reason,
      snapshotId: existing.id as string, action: INVENTORY_AUDIT_ACTION.IMPORT_DUPLICATE_DETECTED,
    })
    return { snapshotId: existing.id as string, created: false }
  }
  try {
    const snapshot = await inventory.createDraftSnapshot({
      actor: input.actor, source: input.source, reason: input.reason,
      inventorySourceId, originalFilename: input.originalFilename, contentHash,
    })
    await inventory.recordImportLifecycleAudit({
      actor: input.actor, source: input.source, reason: input.reason,
      snapshotId: snapshot.id as string, action: INVENTORY_AUDIT_ACTION.IMPORT_STARTED,
    })
    return { snapshotId: snapshot.id as string, created: true }
  } catch (error) {
    if (error instanceof DuplicateSnapshotError) {
      await inventory.recordImportLifecycleAudit({
        actor: input.actor, source: input.source, reason: input.reason,
        snapshotId: error.existingSnapshotId, action: INVENTORY_AUDIT_ACTION.IMPORT_DUPLICATE_DETECTED,
      })
      return { snapshotId: error.existingSnapshotId, created: false }
    }
    throw error
  }
}

async function parseAndPersistEntries(
  inventory: TradingCardInventoryModuleService,
  input: ImportPulseCsvSnapshotInput,
  snapshotId: string,
  file: ValidatedFile,
  sourceLanguage: string | null,
): Promise<{ rows: ParsedPulseRow[]; entryIds: string[] }> {
  const rows = file.dataRows.map((cells, index) => {
    const record: PulseCsvRecord = {}
    file.headers.forEach((header, columnIndex) => { record[header] = cells[columnIndex] })
    return parsePulseRow(record, index + 1, sourceLanguage)
  })
  const persisted = await inventory.addInventorySnapshotEntriesWithDiagnostics({
    actor: input.actor, source: input.source, reason: input.reason,
    snapshotId, rows: rows.map(toImportedSnapshotEntryInput),
  })
  await inventory.recordImportLifecycleAudit({
    actor: input.actor, source: input.source, reason: input.reason,
    snapshotId, action: INVENTORY_AUDIT_ACTION.IMPORT_ENTRIES_PERSISTED, newValue: { rowCount: rows.length },
  })
  return { rows, entryIds: persisted.entryIds }
}

/**
 * Stage 5B.1 Slice 2: coordinates source resolution, bounded file
 * validation, parsing, persistence, matching, lifecycle transitions and the
 * Stage 5A.2 reconciliation hand-off. Each phase below is its own bounded
 * service transaction (or a pure in-memory computation) — no single
 * transaction spans the whole run. Exported as a plain function (not only
 * the wrapped step) so it is directly unit-testable with a fake container,
 * matching this module's existing workflow convention.
 */
export async function importPulseCsvSnapshot(
  container: MedusaContainer,
  input: ImportPulseCsvSnapshotInput,
): Promise<ImportPulseCsvSnapshotResult> {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

  if (input.retryOfSnapshotId) {
    return retryPulseSnapshotMatching(container, {
      actor: input.actor, source: input.source, reason: input.reason,
      snapshotId: input.retryOfSnapshotId, previousApprovedSnapshotId: input.previousApprovedSnapshotId ?? null,
    })
  }

  let inventorySourceId: string
  let sourceLanguage: string | null
  try {
    const resolved = await resolveInventorySource(inventory, input)
    inventorySourceId = resolved.inventorySourceId
    sourceLanguage = resolved.sourceLanguage
  } catch (error) {
    if (error instanceof SourceArchivedError) return { kind: "SOURCE_ARCHIVED", inventorySourceId: input.inventorySourceId }
    throw error
  }

  let file: ValidatedFile
  try {
    file = validatePulseFile(input)
  } catch (error) {
    if (error instanceof ValidationFailedError) return { kind: "VALIDATION_FAILED", reason: error.message, diagnostics: [] }
    throw error
  }

  const { snapshotId, created } = await createOrReturnDraftSnapshot(inventory, input, inventorySourceId, file.contentHash)
  if (!created) {
    const summary = await inventory.getSnapshotImportSummary(snapshotId)
    return { kind: "DUPLICATE", snapshotId, inventorySourceId, snapshotStatus: String(summary.status), importSummary: summary as ImportSummary }
  }

  const { rows, entryIds } = await parseAndPersistEntries(inventory, input, snapshotId, file, sourceLanguage)
  const items = rows.map((row, index) => ({ entryId: entryIds[index], row }))
  await matchAndPersistEntries(inventory, cards, input, snapshotId, items)

  const transition = await transitionSnapshotStatus(inventory, input, snapshotId)
  if (transition.status === INVENTORY_SNAPSHOT_STATUS.FAILED) {
    return { kind: "NO_USABLE_ROWS", snapshotId, inventorySourceId, snapshotStatus: "FAILED" }
  }

  const reconciliationSummary = await invokeReconciliation(container, inventory, input, inventorySourceId, snapshotId)
  const importSummary = await inventory.getSnapshotImportSummary(snapshotId)
  const warnings = await collectWarnings(inventory, snapshotId)

  return {
    kind: "IMPORTED", snapshotId, inventorySourceId, snapshotStatus: String(importSummary.status),
    importSummary: importSummary as ImportSummary, matchingSummary: importSummary.byMatchingStatus,
    reconciliationSummary, warnings,
  }
}

/**
 * The workflow orchestration engine clones step input for its transaction
 * context (observed going through `JSON.stringify`/`parse` even for a
 * single, synchronous, in-memory `LocalWorkflow` run), which turns a real
 * `Buffer` into its JSON shape (`{ type: "Buffer", data: number[] }`) by the
 * time it reaches the step handler. Rebuild a real `Buffer` here — the only
 * place this corruption can occur, since `importPulseCsvSnapshot` itself is
 * also called directly (bypassing the workflow step) by tests and any other
 * in-process caller with a real `Buffer` already in hand.
 */
function reviveFileBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value && typeof value === "object" && (value as { type?: unknown }).type === "Buffer" && Array.isArray((value as { data?: unknown }).data)) {
    return Buffer.from((value as { data: number[] }).data)
  }
  throw new MedusaError(MedusaError.Types.INVALID_DATA, "The uploaded file could not be read")
}

const importPulseCsvSnapshotStep = createStep(
  "import-pulse-csv-snapshot",
  async (input: ImportPulseCsvSnapshotInput, { container }) =>
    new StepResponse(await importPulseCsvSnapshot(container, { ...input, fileBuffer: reviveFileBuffer(input.fileBuffer) })),
)

export const importPulseCsvSnapshotWorkflow = createWorkflow(
  "import-pulse-csv-snapshot",
  (input: ImportPulseCsvSnapshotInput) => new WorkflowResponse(importPulseCsvSnapshotStep(input)),
)
