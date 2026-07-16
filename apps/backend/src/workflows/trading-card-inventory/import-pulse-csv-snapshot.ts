import { createHash } from "node:crypto"
import { parse } from "csv-parse/sync"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { EXTERNAL_PROVIDER, EXTERNAL_REFERENCE_PROVENANCE } from "../../modules/trading-cards/types"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { DuplicateSnapshotError, type ImportedSnapshotEntryInput, type RecordSnapshotEntryMatchBatchItem } from "../../modules/trading-card-inventory/service"
import {
  INVENTORY_AUDIT_ACTION, INVENTORY_PROVIDER_REFERENCE_TYPE, INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS,
  INVENTORY_SNAPSHOT_ENTRY_OUTCOME, INVENTORY_SNAPSHOT_STATUS, INVENTORY_SOURCE_STATUS,
} from "../../modules/trading-card-inventory/types"
import { decodeUtf8Strict, validateHeaders } from "../../modules/trading-card-inventory/pulse/csv-format"
import { parsePulseRow, type PulseCsvRecord } from "../../modules/trading-card-inventory/pulse/row-parser"
import { matchSnapshotEntry, type TradingCardMatchLookup } from "../../modules/trading-card-inventory/pulse/matching"
import { parseProductId } from "../../modules/trading-card-inventory/pulse/product-id"
import { inferProviderLanguageHint, resolveRowLanguage } from "../../modules/trading-card-inventory/pulse/language"
import {
  PULSE_FILE_LIMITS, PULSE_UPLOAD_FILENAME_SUFFIX, PULSE_UPLOAD_MIME_ALLOWLIST, type ParsedPulseRow,
} from "../../modules/trading-card-inventory/pulse/types"
import { reconcileInventorySnapshotWithPriceLocks } from "./reconcile-inventory-snapshot"
import type {
  ImportPulseCsvSnapshotInput, ImportPulseCsvSnapshotResult, ImportSummary, ImportWarning, ReconciliationSummary,
} from "./import-pulse-csv-snapshot-types"

const MATCH_CHUNK_SIZE = 250
const WARNING_CAP = 50
const ADMIN_LIST_PAGE_SIZE = 500

const MATCHABLE_OUTCOMES: readonly string[] = [
  INVENTORY_SNAPSHOT_ENTRY_OUTCOME.VALID, INVENTORY_SNAPSHOT_ENTRY_OUTCOME.VALID_WITH_WARNINGS, INVENTORY_SNAPSHOT_ENTRY_OUTCOME.REVIEW_REQUIRED,
]

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

/** `trading-cards`' `RecordOrigin` has no `SYSTEM` value (unlike this module's `InventoryRecordSource`); anything other than the two shared values maps to `OTHER` when a cross-module audit call is made. */
function toCardsRecordOrigin(source: string): "MANUAL" | "TCGDEX" | "PULSE" | "OTHER" {
  return source === "MANUAL" || source === "PULSE" ? source : "OTHER"
}

/** Implements `pulse/matching.ts`'s injected lookup, backed by the trading-cards module. Kept per-row by design (the pure 04ef033 contract is not modified here) — any batching happens inside the trading-cards read methods themselves. */
function buildTradingCardMatchLookup(cards: TradingCardsModuleService): TradingCardMatchLookup {
  return {
    findTrustedPulseReference: (productId) => cards.findTrustedExternalReference(EXTERNAL_PROVIDER.PULSE, productId),
    findCandidateVariants: (input) => cards.findVariantCandidatesForPulseMatch(input),
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

/** Re-derives the matching-relevant fields of a `ParsedPulseRow` from an immutable, already-persisted entry row plus the (unchanged) source language — used only on retry, never mutates the entry itself. Pure/deterministic given the same provider reference and source language. */
function entryRowToMatchInput(entryRow: Record<string, unknown>, sourceLanguage: string | null): ParsedPulseRow {
  const providerReference = String(entryRow.provider_reference ?? "")
  const productId = parseProductId(providerReference)
  const languageHint = inferProviderLanguageHint(productId.setCodeCandidate)
  const language = resolveRowLanguage(sourceLanguage, languageHint)
  return {
    rowNumber: Number(entryRow.row_number ?? 0),
    outcome: String(entryRow.outcome) as ParsedPulseRow["outcome"],
    providerReference,
    quantity: entryRow.quantity === null || entryRow.quantity === undefined ? null : Number(entryRow.quantity),
    currencyCode: (entryRow.currency_code as string | null) ?? null,
    unitAcquisitionCost: entryRow.unit_acquisition_cost === null || entryRow.unit_acquisition_cost === undefined ? null : String(entryRow.unit_acquisition_cost),
    unitMarketPrice: entryRow.unit_market_price === null || entryRow.unit_market_price === undefined ? null : String(entryRow.unit_market_price),
    unitSellingPrice: entryRow.unit_selling_price === null || entryRow.unit_selling_price === undefined ? null : String(entryRow.unit_selling_price),
    conditionSource: (entryRow.condition_source as ParsedPulseRow["conditionSource"]) ?? null,
    conditionCandidate: productId.conditionCandidate,
    finishCandidate: (entryRow.finish_candidate as string | null) ?? null,
    specialTreatmentCandidate: (entryRow.special_treatment_candidate as string | null) ?? null,
    rarityCandidate: (entryRow.rarity_candidate as string | null) ?? null,
    rarityRaw: (entryRow.rarity_raw as string | null) ?? null,
    languageConflict: Boolean(entryRow.language_conflict),
    languageCandidate: language.language,
    cardNumberCandidate: productId.cardNumberCandidate,
    setCodeCandidate: productId.setCodeCandidate,
    gradedCardDetected: false,
    rawFields: {},
    diagnostics: [],
  }
}

/**
 * Batched matching, chunked so this workflow issues one persistence
 * transaction per ~250 rows instead of one per row. `matchSnapshotEntry`
 * itself is still called once per row (cheap, pure, in-memory); only the
 * write side (`recordSnapshotEntryMatches`) and the trading-cards reads are
 * batched at the chunk boundary.
 */
async function matchAndPersistEntries(
  inventory: TradingCardInventoryModuleService,
  cards: TradingCardsModuleService,
  input: ImportPulseCsvSnapshotInput,
  snapshotId: string,
  items: Array<{ entryId: string; row: ParsedPulseRow }>,
): Promise<void> {
  const lookup = buildTradingCardMatchLookup(cards)
  for (let offset = 0; offset < items.length; offset += MATCH_CHUNK_SIZE) {
    const chunk = items.slice(offset, offset + MATCH_CHUNK_SIZE)
    const matchable = chunk.filter(({ row }) => MATCHABLE_OUTCOMES.includes(row.outcome))
    if (matchable.length === 0) continue
    const outcomes = await Promise.all(matchable.map(({ row }) => matchSnapshotEntry(row, lookup)))
    for (let index = 0; index < matchable.length; index += 1) {
      const outcome = outcomes[index]
      if (outcome.shouldPersistTrustedReference && outcome.tradingCardVariantId) {
        const variant = await cards.retrieveTradingCardVariant(outcome.tradingCardVariantId)
        await cards.upsertExternalReference({
          actor: input.actor, source: toCardsRecordOrigin(input.source), reason: input.reason,
          tradingCardId: variant.trading_card_id as string, tradingCardVariantId: outcome.tradingCardVariantId,
          provider: EXTERNAL_PROVIDER.PULSE, providerIdentifier: matchable[index].row.providerReference,
          provenance: EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL,
        })
      }
    }
    const batchItems: RecordSnapshotEntryMatchBatchItem[] = matchable.map(({ entryId }, index) => ({
      snapshotEntryId: entryId,
      matchingStatus: outcomes[index].matchingStatus,
      tradingCardVariantId: outcomes[index].tradingCardVariantId,
      matchedVia: outcomes[index].matchedVia,
      diagnostics: outcomes[index].diagnostics.map((diagnostic) => ({
        rowNumber: diagnostic.rowNumber, phase: diagnostic.phase, code: diagnostic.code,
        severity: diagnostic.severity, fieldRef: diagnostic.fieldRef, message: diagnostic.message,
      })),
    }))
    await inventory.recordSnapshotEntryMatches({
      actor: input.actor, source: input.source, reason: input.reason,
      inventorySnapshotId: snapshotId, entries: batchItems,
    })
  }
  await inventory.recordImportLifecycleAudit({
    actor: input.actor, source: input.source, reason: input.reason,
    snapshotId, action: INVENTORY_AUDIT_ACTION.IMPORT_MATCHING_COMPLETED,
  })
}

async function transitionSnapshotStatus(
  inventory: TradingCardInventoryModuleService,
  input: ImportPulseCsvSnapshotInput,
  snapshotId: string,
): Promise<{ status: string }> {
  const summary = await inventory.getSnapshotImportSummary(snapshotId)
  const usableRowCount = Object.entries(summary.byOutcome)
    .filter(([outcome]) => outcome !== INVENTORY_SNAPSHOT_ENTRY_OUTCOME.INVALID && outcome !== INVENTORY_SNAPSHOT_ENTRY_OUTCOME.SKIPPED)
    .reduce((sum, [, count]) => sum + count, 0)
  if (usableRowCount === 0) {
    await inventory.transitionInventorySnapshotStatus({
      actor: input.actor, source: input.source, reason: input.reason,
      id: snapshotId, targetStatus: INVENTORY_SNAPSHOT_STATUS.FAILED, failureReason: "No usable rows after parsing and validation",
    })
    await inventory.recordImportLifecycleAudit({
      actor: input.actor, source: input.source, reason: input.reason,
      snapshotId, action: INVENTORY_AUDIT_ACTION.IMPORT_FAILED, newValue: { reason: "NO_USABLE_ROWS" },
    })
    return { status: INVENTORY_SNAPSHOT_STATUS.FAILED }
  }
  await inventory.transitionInventorySnapshotStatus({
    actor: input.actor, source: input.source, reason: input.reason,
    id: snapshotId, targetStatus: INVENTORY_SNAPSHOT_STATUS.VALIDATED,
  })
  return { status: INVENTORY_SNAPSHOT_STATUS.VALIDATED }
}

async function invokeReconciliation(
  container: MedusaContainer,
  inventory: TradingCardInventoryModuleService,
  input: ImportPulseCsvSnapshotInput,
  inventorySourceId: string,
  snapshotId: string,
): Promise<ReconciliationSummary> {
  await inventory.recordImportLifecycleAudit({
    actor: input.actor, source: input.source, reason: input.reason,
    snapshotId, action: INVENTORY_AUDIT_ACTION.IMPORT_RECONCILIATION_STARTED,
  })
  const summary = await reconcileInventorySnapshotWithPriceLocks(container, {
    actor: input.actor, source: input.source, reason: input.reason,
    inventorySourceId, snapshotId, previousApprovedSnapshotId: input.previousApprovedSnapshotId ?? null,
  })
  await inventory.recordImportLifecycleAudit({
    actor: input.actor, source: input.source, reason: input.reason,
    snapshotId, action: INVENTORY_AUDIT_ACTION.IMPORT_RECONCILIATION_COMPLETED,
    newValue: { proposalCount: summary.proposalCount },
  })
  return summary as ReconciliationSummary
}

async function collectWarnings(inventory: TradingCardInventoryModuleService, snapshotId: string): Promise<ImportWarning[]> {
  const { rows } = await inventory.listSnapshotEntryDiagnostics(snapshotId, { severity: "WARNING" }, { limit: WARNING_CAP, offset: 0 })
  return rows.map((row) => ({
    rowNumber: Number(row.row_number), phase: row.phase as "PARSE" | "MATCHING", code: String(row.code),
    severity: row.severity as "INFO" | "WARNING" | "ERROR", fieldRef: (row.field_ref as string | null) ?? null, message: String(row.message),
  }))
}

async function loadEntriesNeedingMatch(
  inventory: TradingCardInventoryModuleService, snapshotId: string, sourceLanguage: string | null,
): Promise<Array<{ entryId: string; row: ParsedPulseRow }>> {
  const items: Array<{ entryId: string; row: ParsedPulseRow }> = []
  let offset = 0
  for (;;) {
    const { rows, count } = await inventory.listSnapshotEntriesForAdmin(snapshotId, {}, { limit: ADMIN_LIST_PAGE_SIZE, offset })
    for (const row of rows) {
      if (!MATCHABLE_OUTCOMES.includes(String(row.outcome))) continue
      const matchingStatus = row.matching_status as string | null
      const needsMatch = !matchingStatus ||
        matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.UNMATCHED ||
        matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.AMBIGUOUS ||
        matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.REVIEW_REQUIRED
      if (needsMatch) items.push({ entryId: row.id as string, row: entryRowToMatchInput(row, sourceLanguage) })
    }
    offset += ADMIN_LIST_PAGE_SIZE
    if (offset >= count) break
  }
  return items
}

async function retryImport(
  container: MedusaContainer,
  inventory: TradingCardInventoryModuleService,
  cards: TradingCardsModuleService,
  input: ImportPulseCsvSnapshotInput,
  snapshotId: string,
): Promise<ImportPulseCsvSnapshotResult> {
  const snapshot = await inventory.retrieveInventorySnapshot(snapshotId)
  const inventorySourceId = snapshot.inventory_source_id as string
  const sourceRow = await inventory.retrieveInventorySource(inventorySourceId)
  const sourceLanguage = (sourceRow.language as string | null) ?? null

  if (!snapshot.row_count) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cannot retry a snapshot with no persisted entries; re-upload the file")
  }

  const itemsNeedingMatch = await loadEntriesNeedingMatch(inventory, snapshotId, sourceLanguage)
  if (itemsNeedingMatch.length > 0) {
    await matchAndPersistEntries(inventory, cards, input, snapshotId, itemsNeedingMatch)
  }

  if (snapshot.status === INVENTORY_SNAPSHOT_STATUS.DRAFT) {
    const transition = await transitionSnapshotStatus(inventory, input, snapshotId)
    if (transition.status === INVENTORY_SNAPSHOT_STATUS.FAILED) {
      return { kind: "NO_USABLE_ROWS", snapshotId, inventorySourceId, snapshotStatus: "FAILED" }
    }
  }

  const current = await inventory.retrieveInventorySnapshot(snapshotId)
  let reconciliationSummary: ReconciliationSummary | undefined
  if (current.status === INVENTORY_SNAPSHOT_STATUS.VALIDATED || current.status === INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW) {
    reconciliationSummary = await invokeReconciliation(container, inventory, input, inventorySourceId, snapshotId)
  }

  const importSummary = await inventory.getSnapshotImportSummary(snapshotId)
  const warnings = await collectWarnings(inventory, snapshotId)
  return {
    kind: "IMPORTED", snapshotId, inventorySourceId, snapshotStatus: String(importSummary.status),
    importSummary: importSummary as ImportSummary, matchingSummary: importSummary.byMatchingStatus,
    reconciliationSummary, warnings,
  }
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
    return retryImport(container, inventory, cards, input, input.retryOfSnapshotId)
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

const importPulseCsvSnapshotStep = createStep(
  "import-pulse-csv-snapshot",
  async (input: ImportPulseCsvSnapshotInput, { container }) =>
    new StepResponse(await importPulseCsvSnapshot(container, input)),
)

export const importPulseCsvSnapshotWorkflow = createWorkflow(
  "import-pulse-csv-snapshot",
  (input: ImportPulseCsvSnapshotInput) => new WorkflowResponse(importPulseCsvSnapshotStep(input)),
)
