import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { EXTERNAL_PROVIDER, EXTERNAL_REFERENCE_PROVENANCE } from "../../modules/trading-cards/types"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { AuditContext, RecordSnapshotEntryMatchBatchItem } from "../../modules/trading-card-inventory/service"
import {
  INVENTORY_AUDIT_ACTION, INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS, INVENTORY_SNAPSHOT_ENTRY_OUTCOME, INVENTORY_SNAPSHOT_STATUS,
} from "../../modules/trading-card-inventory/types"
import { matchSnapshotEntry, type TradingCardMatchLookup } from "../../modules/trading-card-inventory/pulse/matching"
import { parseProductId } from "../../modules/trading-card-inventory/pulse/product-id"
import { inferProviderLanguageHint, resolveRowLanguage } from "../../modules/trading-card-inventory/pulse/language"
import type { ParsedPulseRow } from "../../modules/trading-card-inventory/pulse/types"
import { reconcileInventorySnapshotWithPriceLocks } from "./reconcile-inventory-snapshot"
import type {
  ImportPulseCsvSnapshotResult, ImportSummary, ImportWarning, ReconciliationSummary,
} from "./import-pulse-csv-snapshot-types"
import type { RetryPulseSnapshotMatchingInput } from "./retry-pulse-snapshot-matching-types"

/**
 * Stage 5B.1 Slice 3: helpers shared between the original upload-and-import
 * workflow and the dedicated retry-matching workflow, so re-running matching
 * for an already-persisted snapshot exists as exactly one implementation.
 * Extracted out of `import-pulse-csv-snapshot.ts` without behaviour changes.
 */

export const MATCH_CHUNK_SIZE = 250
export const WARNING_CAP = 50
export const ADMIN_LIST_PAGE_SIZE = 500

export const MATCHABLE_OUTCOMES: readonly string[] = [
  INVENTORY_SNAPSHOT_ENTRY_OUTCOME.VALID, INVENTORY_SNAPSHOT_ENTRY_OUTCOME.VALID_WITH_WARNINGS, INVENTORY_SNAPSHOT_ENTRY_OUTCOME.REVIEW_REQUIRED,
]

/** `trading-cards`' `RecordOrigin` has no `SYSTEM` value (unlike this module's `InventoryRecordSource`); anything other than the two shared values maps to `OTHER` when a cross-module audit call is made. */
export function toCardsRecordOrigin(source: string): "MANUAL" | "TCGDEX" | "PULSE" | "OTHER" {
  return source === "MANUAL" || source === "PULSE" ? source : "OTHER"
}

/**
 * Implements `pulse/matching.ts`'s injected lookup, backed by the
 * trading-cards module. Kept per-row by design (the pure 04ef033 contract is
 * not modified here) — any batching happens inside the trading-cards read
 * methods themselves.
 *
 * `findTrustedExternalReference` validates its identifier against
 * `providerIdentifierSchema` (a TCGdex-oriented, URL-safe-slug validator
 * that rejects whitespace) — but a Pulse provider reference legitimately
 * embeds verbatim CSV tokens like a material name ("Reverse Holo", "Poké
 * Ball") that contain spaces. Rather than loosen that shared, cross-module
 * validator (used for TCGdex card/set identifiers elsewhere), a Pulse
 * reference that fails it is treated the same as "no trusted reference
 * found" here — the row still proceeds to attribute-based candidate
 * matching / `REVIEW_REQUIRED` instead of the request failing outright.
 */
export function buildTradingCardMatchLookup(cards: TradingCardsModuleService): TradingCardMatchLookup {
  return {
    findTrustedPulseReference: async (productId) => {
      try {
        return await cards.findTrustedExternalReference(EXTERNAL_PROVIDER.PULSE, productId)
      } catch {
        return null
      }
    },
    findCandidateVariants: (input) => cards.findVariantCandidatesForPulseMatch(input),
  }
}

/** Re-derives the matching-relevant fields of a `ParsedPulseRow` from an immutable, already-persisted entry row plus the (unchanged) source language — used only on retry, never mutates the entry itself. Pure/deterministic given the same provider reference and source language. */
export function entryRowToMatchInput(entryRow: Record<string, unknown>, sourceLanguage: string | null): ParsedPulseRow {
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
export async function matchAndPersistEntries(
  inventory: TradingCardInventoryModuleService,
  cards: TradingCardsModuleService,
  input: AuditContext,
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

export async function transitionSnapshotStatus(
  inventory: TradingCardInventoryModuleService,
  input: AuditContext,
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

export async function invokeReconciliation(
  container: MedusaContainer,
  inventory: TradingCardInventoryModuleService,
  input: AuditContext & { previousApprovedSnapshotId?: string | null },
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

export async function collectWarnings(inventory: TradingCardInventoryModuleService, snapshotId: string): Promise<ImportWarning[]> {
  const { rows } = await inventory.listSnapshotEntryDiagnostics(snapshotId, { severity: "WARNING" }, { limit: WARNING_CAP, offset: 0 })
  return rows.map((row) => ({
    rowNumber: Number(row.row_number), phase: row.phase as "PARSE" | "MATCHING", code: String(row.code),
    severity: row.severity as "INFO" | "WARNING" | "ERROR", fieldRef: (row.field_ref as string | null) ?? null, message: String(row.message),
  }))
}

export async function loadEntriesNeedingMatch(
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

/**
 * Stage 5B.1 Slice 3: narrow, file-free re-entry point for re-running
 * matching (and, where reached, reconciliation) against an
 * already-persisted snapshot. This is the single implementation used both
 * by the dedicated `retry-pulse-snapshot-matching` workflow and by
 * `import-pulse-csv-snapshot`'s own (legacy) `retryOfSnapshotId` input path.
 */
export async function retryPulseSnapshotMatching(
  container: MedusaContainer,
  input: RetryPulseSnapshotMatchingInput,
): Promise<ImportPulseCsvSnapshotResult> {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const { snapshotId } = input

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
