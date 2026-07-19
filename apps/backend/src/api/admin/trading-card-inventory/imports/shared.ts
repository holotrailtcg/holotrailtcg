import { z } from "@medusajs/framework/zod"
import {
  INVENTORY_CARD_FINISH, INVENTORY_PROVIDER, INVENTORY_RARITY,
  INVENTORY_SNAPSHOT_ENTRY_OUTCOME, INVENTORY_DIAGNOSTIC_SEVERITY, INVENTORY_SNAPSHOT_STATUS,
  INVENTORY_SOURCE_LANGUAGE, INVENTORY_SPECIAL_TREATMENT,
} from "../../../../modules/trading-card-inventory/types"
import { parseProductId } from "../../../../modules/trading-card-inventory/pulse/product-id"
import { CARD_GAME, EXTERNAL_PROVIDER, type CardLanguage } from "../../../../modules/trading-cards/types"
import { tradingCardsService, type SafeCardIdentity } from "../shared"
import type { MedusaRequest } from "@medusajs/framework/http"

export {
  adminActor, attachCardIdentities, idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite, tradingCardInventoryService,
  tradingCardsService,
} from "../shared"

export interface SafeTcgdexCandidate {
  id: string
  reviewStatus: "PENDING" | "ACCEPTED"
  name: string
  setName: string
  seriesName: string | null
  referenceArtworkUrl: string | null
  providerRarity: string | null
}

/**
 * Fills in `tcgdexCandidate` on a page of entry DTOs — a `MATCHED`+`PENDING`
 * TCGdex lookup result for a row that has no matched variant yet, if one
 * has already been cached (see `process-tcgdex-lookup-batch.ts`). Batched
 * per unique (set, card number) so a page of duplicate rows for the same
 * card only costs one lookup, not one per row.
 */
export async function attachTcgdexCandidates<T extends {
  providerReference: string | null
  tradingCardVariantId: string | null
  tcgdexCandidate: SafeTcgdexCandidate | null
}>(req: MedusaRequest, rows: T[], language: CardLanguage | null): Promise<T[]> {
  if (!language) return rows
  const cards = tradingCardsService(req)
  const setMappingCache = new Map<string, { setId: string; setName: string; seriesName: string | null } | null>()
  const candidateCache = new Map<string, SafeTcgdexCandidate | null>()

  const result: T[] = []
  for (const row of rows) {
    if (!row.providerReference) { result.push(row); continue }
    const parsed = parseProductId(row.providerReference)
    if (!parsed.setCodeCandidate || !parsed.cardNumberCandidate) { result.push(row); continue }

    let setMapping = setMappingCache.get(parsed.setCodeCandidate)
    if (setMapping === undefined) {
      const mapping = await cards.findProviderSetMapping({
        provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON, language, providerSetCode: parsed.setCodeCandidate,
      })
      setMapping = mapping ? {
        setId: mapping.tcgdex_set_id as string,
        setName: mapping.tcgdex_set_name as string,
        seriesName: (mapping.tcgdex_series_name as string | null) ?? null,
      } : null
      setMappingCache.set(parsed.setCodeCandidate, setMapping)
    }
    if (!setMapping) { result.push(row); continue }

    const cardNumber = parsed.cardNumberCandidate.split("/")[0].trim()
    const cacheKey = `${setMapping.setId}::${cardNumber}`
    let candidate = candidateCache.get(cacheKey)
    if (candidate === undefined) {
      const found = await cards.findTcgdexLookupCandidate({ provider: EXTERNAL_PROVIDER.PULSE, language, tcgdexSetId: setMapping.setId, cardNumber })
      const enrichment = found?.enrichment as { name?: string; referenceArtworkUrl?: string; providerRarity?: string } | null
      candidate = found && found.match_outcome === "MATCHED"
        && (found.review_status === "PENDING" || found.review_status === "ACCEPTED") && enrichment?.name
        ? {
            id: found.id as string, reviewStatus: found.review_status, name: enrichment.name,
            setName: setMapping.setName, seriesName: setMapping.seriesName,
            referenceArtworkUrl: enrichment.referenceArtworkUrl ?? null, providerRarity: enrichment.providerRarity ?? null,
          }
        : null
      candidateCache.set(cacheKey, candidate)
    }
    result.push({ ...row, tcgdexCandidate: candidate })
  }
  return result
}

/**
 * Stage 5B.1 Slice 3: exactly one of the two source-selection paths must be
 * present in an upload request — an existing active source, or a full
 * new-source spec. Multipart text fields always arrive as strings, so an
 * absent field is `undefined`, never `null`.
 */
export const uploadCsvBodySchema = z.object({
  inventorySourceId: z.string().min(1).optional(),
  newSourceDisplayName: z.string().trim().min(1).max(255).optional(),
  newSourceProvider: z.enum(Object.values(INVENTORY_PROVIDER) as [string, ...string[]]).optional(),
  newSourceLanguage: z.enum(Object.values(INVENTORY_SOURCE_LANGUAGE) as [string, ...string[]]).optional(),
  newSourceDefaultCurrencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  previousApprovedSnapshotId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
}).strict().refine(
  (value) => Boolean(value.inventorySourceId) !== Boolean(value.newSourceDisplayName && value.newSourceProvider),
  { message: "Provide either inventorySourceId or newSourceDisplayName together with newSourceProvider, not both or neither" },
)

export const snapshotEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  sortBy: z.enum(["cardName", "set", "quantity", "purchasePrice", "marketPrice", "salePrice", "finish", "variant", "rarity", "reviewStatus"]).default("cardName"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  outcome: z.enum(Object.values(INVENTORY_SNAPSHOT_ENTRY_OUTCOME) as [string, ...string[]]).optional(),
  reviewStatus: z.enum(["ACTION_REQUIRED", "AWAITING_REVIEW", "NOT_MATCHED", "MATCHED", "AMBIGUOUS"]).optional(),
  finishCandidate: z.enum(Object.values(INVENTORY_CARD_FINISH) as [string, ...string[]]).optional(),
  specialTreatmentCandidate: z.enum(Object.values(INVENTORY_SPECIAL_TREATMENT) as [string, ...string[]]).optional(),
  rarityCandidate: z.enum(Object.values(INVENTORY_RARITY) as [string, ...string[]]).optional(),
  duplicateReferenceOnly: z.coerce.boolean().optional(),
  snapshotEntryId: z.string().min(1).optional(),
  providerReference: z.string().min(1).max(255).optional(),
}).strict()

export const snapshotDiagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  severity: z.enum(Object.values(INVENTORY_DIAGNOSTIC_SEVERITY) as [string, ...string[]]).optional(),
  snapshotEntryId: z.string().min(1).optional(),
}).strict()

export const retryMatchingBodySchema = z.object({
  reason: z.string().max(500).optional(),
}).strict()

export const discardSnapshotBodySchema = z.object({
  reason: z.string().max(500).optional(),
}).strict()

export const reconcileBodySchema = z.object({
  previousApprovedSnapshotId: z.string().min(1).nullish(),
  reason: z.string().max(500).optional(),
}).strict()

export const snapshotListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  inventorySourceId: z.string().min(1).optional(),
  status: z.enum(Object.values(INVENTORY_SNAPSHOT_STATUS) as [string, ...string[]]).optional(),
}).strict()

/** Allow-listed Admin view of a snapshot list row — minimal, navigation-only fields. */
export function toSafeInventorySnapshotListItemDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    inventorySourceId: row.inventory_source_id,
    status: row.status,
    sequenceNumber: row.sequence_number,
    originalFilename: row.original_filename ?? null,
    rowCount: row.row_count ?? null,
    createdAt: row.created_at,
  }
}

/** Allow-listed Admin view of an entry row — never returns `raw_fields`. */
export function toSafeSnapshotEntryDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    rowNumber: row.row_number,
    providerReference: (row.provider_reference as string | null) ?? null,
    quantity: row.quantity,
    currencyCode: row.currency_code ?? null,
    unitAcquisitionCost: row.unit_acquisition_cost === null || row.unit_acquisition_cost === undefined ? null : String(row.unit_acquisition_cost),
    unitMarketPrice: row.unit_market_price === null || row.unit_market_price === undefined ? null : String(row.unit_market_price),
    unitSellingPrice: row.unit_selling_price === null || row.unit_selling_price === undefined ? null : String(row.unit_selling_price),
    conditionSource: row.condition_source ?? null,
    conditionCandidate: (row.condition_candidate as string | null) ?? null,
    finishCandidate: row.finish_candidate ?? null,
    specialTreatmentCandidate: row.special_treatment_candidate ?? null,
    rarityCandidate: row.rarity_candidate ?? null,
    rarityRaw: row.rarity_raw ?? null,
    languageConflict: Boolean(row.language_conflict),
    outcome: row.outcome ?? null,
    tradingCardVariantId: (row.matched_trading_card_variant_id as string | null) ?? (row.trading_card_variant_id as string | null) ?? null,
    matchingStatus: row.matching_status ?? null,
    matchedVia: row.matched_via ?? null,
    retryCount: row.retry_count ?? 0,
    // Populated by `attachCardIdentities`/`attachTcgdexCandidates` after the
    // base DTO is built — never read directly from `row`.
    card: null as SafeCardIdentity | null,
    cardIdentityHint: null as string | null,
    tcgdexCandidate: null as SafeTcgdexCandidate | null,
  }
}

/** Allow-listed Admin view of a diagnostic row — no raw payloads. */
export function toSafeDiagnosticDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    snapshotEntryId: row.snapshot_entry_id,
    rowNumber: row.row_number,
    phase: row.phase,
    code: row.code,
    severity: row.severity,
    fieldRef: row.field_ref ?? null,
    message: row.message,
  }
}
