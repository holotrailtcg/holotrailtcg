import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../../modules/trading-card-inventory/service"
import {
  INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_PROVIDER, INVENTORY_SOURCE_STATUS,
} from "../../../modules/trading-card-inventory/types"
import { PROPOSAL_BATCH_MAX_SIZE } from "../../../modules/trading-card-inventory/validation"
import { parseProductId } from "../../../modules/trading-card-inventory/pulse/product-id"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import type TradingCardsModuleService from "../../../modules/trading-cards/service"

export function tradingCardInventoryService(req: MedusaRequest): TradingCardInventoryModuleService {
  return req.scope.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
}

export function tradingCardsService(req: MedusaRequest): TradingCardsModuleService {
  return req.scope.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
}

/** The authenticated Admin user's actor ID. Never accepted from the request body. */
export function adminActor(req: AuthenticatedMedusaRequest): string {
  return req.auth_context.actor_id
}

export function parseAdminInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The request parameters are invalid.")
  }
  return result.data
}

/**
 * A `MedusaError` thrown from inside a workflow step (as every Stage 5B.1
 * Pulse import workflow does) crosses the workflow orchestration engine's
 * transaction-context boundary and loses its prototype chain by the time it
 * reaches the calling route — `error instanceof MedusaError` is `false`,
 * even though the object still carries `__isMedusaError`, `type`, `message`
 * and `code`. `MedusaError.isMedusaError` is the framework's own duck-typed
 * check for exactly this case; reconstruct a real `MedusaError` from the
 * surviving fields so it still maps to the correct HTTP status rather than
 * falling through to a generic 500.
 */
function reviveMedusaError(error: unknown): MedusaError | null {
  if (error instanceof MedusaError) return error
  if (MedusaError.isMedusaError(error)) {
    const revived = error as { type: string; message: string; code?: string }
    return new MedusaError(revived.type, revived.message, revived.code)
  }
  return null
}

export async function safeAdminRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    const medusaError = reviveMedusaError(error)
    if (medusaError) throw medusaError
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The inventory data could not be loaded.")
  }
}

export async function safeAdminWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    const medusaError = reviveMedusaError(error)
    if (medusaError) throw medusaError
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The inventory action could not be completed.")
  }
}

export const idParamsSchema = z.object({ id: z.string().min(1) })
export const variantIdParamsSchema = z.object({ variantId: z.string().min(1) })

export const sourceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  status: z.enum(Object.values(INVENTORY_SOURCE_STATUS) as [string, ...string[]]).optional(),
  provider: z.enum(Object.values(INVENTORY_PROVIDER) as [string, ...string[]]).optional(),
}).strict()

export const transactionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  inventorySourceId: z.string().min(1).optional(),
  tradingCardVariantId: z.string().min(1).optional(),
}).strict()

export const proposalListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  inventorySourceId: z.string().min(1).optional(),
  inventorySnapshotId: z.string().min(1).optional(),
  tradingCardVariantId: z.string().min(1).optional(),
  changeKind: z.enum(Object.values(INVENTORY_PROPOSAL_CHANGE_KIND) as [string, ...string[]]).optional(),
  reviewStatus: z.enum(Object.values(INVENTORY_PROPOSAL_REVIEW_STATUS) as [string, ...string[]]).optional(),
}).strict()

export const proposalSummaryQuerySchema = z.object({
  inventorySnapshotId: z.string().min(1),
}).strict()

export const proposalAuditHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

const proposalReviewTargetStatusSchema = z.enum([
  INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED, INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED,
] as [string, ...string[]])

/** No `actor`/`reviewedBy` field — the reviewer identity is always `adminActor(req)`, never client-supplied. */
export const proposalReviewBodySchema = z.object({
  targetStatus: proposalReviewTargetStatusSchema,
  rejectionReason: z.string().max(2000).nullish(),
  reviewNote: z.string().max(500).nullish(),
}).strict()

export const proposalBulkReviewBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(PROPOSAL_BATCH_MAX_SIZE),
  targetStatus: proposalReviewTargetStatusSchema,
  rejectionReason: z.string().max(2000).nullish(),
  reviewNote: z.string().max(500).nullish(),
}).strict()

export const proposalBulkApplyBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(PROPOSAL_BATCH_MAX_SIZE),
}).strict()

export const createSourceBodySchema = z.object({
  displayName: z.string().trim().min(1).max(255),
  provider: z.enum(Object.values(INVENTORY_PROVIDER) as [string, ...string[]]),
  language: z.enum(["EN", "JA", "ZH"]).nullish(),
  defaultCurrencyCode: z.string().regex(/^[A-Z]{3}$/).nullish(),
  defaultPricingProfileKey: z.string().max(255).nullish(),
  defaultStorefrontCategoryId: z.string().max(255).nullish(),
  notes: z.string().max(1000).nullish(),
}).strict()

export const renameSourceBodySchema = z.object({
  displayName: z.string().trim().min(1).max(255),
}).strict()

/** Allow-listed Admin view of an `InventorySource` row — never leaks `provider_metadata` or internal jsonb payloads. */
export function toSafeInventorySourceDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    language: row.language ?? null,
    status: row.status,
    defaultCurrencyCode: row.default_currency_code ?? null,
    defaultPricingProfileKey: row.default_pricing_profile_key ?? null,
    defaultStorefrontCategoryId: row.default_storefront_category_id ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toSafeInventoryTransactionDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    tradingCardVariantId: row.trading_card_variant_id,
    inventorySourceId: row.inventory_source_id ?? null,
    inventoryHoldingId: row.inventory_holding_id ?? null,
    inventorySnapshotId: row.inventory_snapshot_id ?? null,
    quantityBefore: row.quantity_before,
    quantityAfter: row.quantity_after,
    quantityDelta: row.quantity_delta,
    reason: row.reason,
    originatingReference: row.originating_reference ?? null,
    actor: row.actor,
    note: row.note ?? null,
    createdAt: row.created_at,
  }
}

export interface SafeCardIdentity {
  tradingCardId: string
  name: string
  setDisplayName: string
  cardNumber: string
  rarity: string | null
  rarityRaw: string | null
  condition: string
  finish: string
  specialTreatment: string
  sku: string
}

export function toSafeInventoryProposalDto(row: Record<string, unknown>) {
  const diagnostics = row.reconciliation_diagnostics as Record<string, unknown> | null
  return {
    id: row.id,
    inventorySourceId: row.inventory_source_id,
    inventorySnapshotId: row.inventory_snapshot_id ?? null,
    baselineSnapshotId: row.baseline_snapshot_id ?? null,
    tradingCardVariantId: (row.trading_card_variant_id as string | null) ?? null,
    // Populated by `attachCardIdentities` after the base DTO is built — never
    // set from the raw inventory-module row, which has no visibility into
    // the trading-cards module's data.
    card: null as SafeCardIdentity | null,
    cardIdentityHint: null as string | null,
    providerReference: (row.provider_reference as string | null) ?? null,
    providerReferenceType: row.provider_reference_type ?? null,
    previousQuantity: row.previous_quantity ?? null,
    proposedQuantity: row.proposed_quantity ?? null,
    quantityDelta: row.quantity_delta ?? null,
    currencyCode: row.currency_code ?? null,
    previousUnitAcquisitionCost: row.previous_unit_acquisition_cost === null ? null : String(row.previous_unit_acquisition_cost),
    proposedUnitAcquisitionCost: row.proposed_unit_acquisition_cost === null ? null : String(row.proposed_unit_acquisition_cost),
    previousUnitMarketPrice: row.previous_unit_market_price === null ? null : String(row.previous_unit_market_price),
    proposedUnitMarketPrice: row.proposed_unit_market_price === null ? null : String(row.proposed_unit_market_price),
    previousUnitSellingPrice: row.previous_unit_selling_price === null ? null : String(row.previous_unit_selling_price),
    proposedUnitSellingPrice: row.proposed_unit_selling_price === null ? null : String(row.proposed_unit_selling_price),
    changeKind: row.change_kind,
    reviewStatus: row.review_status,
    reason: row.reconciliation_reason ?? null,
    diagnostics: diagnostics ? {
      changedFields: Array.isArray(diagnostics.changedFields) ? diagnostics.changedFields.slice(0, 8) : [],
      duplicateRowCount: diagnostics.duplicateRowCount ?? 1,
      sellingPriceLocked: diagnostics.sellingPriceLocked === true,
    } : null,
    comparedAt: row.compared_at ?? null,
    createdAt: row.created_at,
    // Stage 5B.2 review/application/sync fields. `reviewStatus` (above) and
    // `medusaSyncStatus` are always independent: APPLIED describes the local
    // authoritative stock movement only and says nothing about whether the
    // result has reached Medusa yet. Never collapse the two into one field.
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    reviewNote: row.review_note ?? null,
    appliedAt: row.applied_at ?? null,
    appliedTransactionId: row.applied_transaction_id ?? null,
    appliedHoldingId: row.applied_holding_id ?? null,
    medusaSyncStatus: row.medusa_sync_status ?? "NOT_APPLICABLE",
    medusaInventoryItemId: row.medusa_inventory_item_id ?? null,
    medusaStockLocationId: row.medusa_stock_location_id ?? null,
    medusaSyncAttemptedAt: row.medusa_sync_attempted_at ?? null,
    medusaSyncSucceededAt: row.medusa_sync_succeeded_at ?? null,
    medusaSyncRetryCount: row.medusa_sync_retry_count ?? 0,
    medusaSyncLastError: row.medusa_sync_last_error ?? null,
    // E2B category assignment
    proposedEbayStoreCategoryId: (row.proposed_ebay_store_category_id as string | null) ?? null,
    proposedCategoryReason: (row.proposed_category_reason as string | null) ?? null,
    proposedCategoryRuleId: (row.proposed_category_rule_id as string | null) ?? null,
    confirmedEbayStoreCategoryId: (row.confirmed_ebay_store_category_id as string | null) ?? null,
    categoryConfirmedAt: row.category_confirmed_at ?? null,
    categoryConfirmedBy: row.category_confirmed_by ?? null,
  }
}

/**
 * Fills in `card` / `cardIdentityHint` on a page of proposal DTOs, batched
 * into a single cross-module read. Resolved rows (`tradingCardVariantId` set)
 * get the real card name/set/number from the trading-cards module; unresolved
 * rows fall back to a best-effort hint decoded from the Pulse provider
 * reference, so the review table is never just a bare ID or "Unresolved"
 * with no way to tell which physical card a row is about.
 */
export async function attachCardIdentities<T extends {
  tradingCardVariantId: string | null
  providerReference: string | null
  card: SafeCardIdentity | null
  cardIdentityHint: string | null
}>(req: MedusaRequest, rows: T[]): Promise<T[]> {
  const variantIds = [...new Set(rows.map((row) => row.tradingCardVariantId).filter((id): id is string => Boolean(id)))]
  const identityByVariantId = new Map<string, SafeCardIdentity>()
  if (variantIds.length > 0) {
    const variants = await tradingCardsService(req).listTradingCardVariants(
      { id: variantIds }, { relations: ["trading_card", "trading_card.card_set"] },
    )
    for (const variant of variants as Array<Record<string, unknown>>) {
      const tradingCard = variant.trading_card as Record<string, unknown> | undefined
      const cardSet = tradingCard?.card_set as Record<string, unknown> | undefined
      if (!tradingCard) continue
      identityByVariantId.set(variant.id as string, {
        tradingCardId: tradingCard.id as string,
        name: tradingCard.name as string,
        setDisplayName: (cardSet?.display_name as string | undefined) ?? "Unknown set",
        cardNumber: tradingCard.card_number as string,
        rarity: (tradingCard.rarity as string | null | undefined) ?? null,
        rarityRaw: (tradingCard.rarity_raw as string | null | undefined) ?? null,
        condition: variant.condition as string,
        finish: variant.finish as string,
        specialTreatment: variant.special_treatment as string,
        sku: variant.sku as string,
      })
    }
  }
  return rows.map((row) => {
    const card = row.tradingCardVariantId ? identityByVariantId.get(row.tradingCardVariantId) ?? null : null
    if (card) return { ...row, card }
    if (!row.providerReference) return row
    const parsed = parseProductId(row.providerReference)
    if (!parsed.setCodeCandidate && !parsed.cardNumberCandidate) return row
    const hint = [parsed.setCodeCandidate, parsed.cardNumberCandidate].filter(Boolean).join(" ")
    return { ...row, cardIdentityHint: hint || null }
  })
}

/**
 * Allow-listed Admin view of one audit-trail entry — `old_value`/`new_value`
 * are already-bounded structured JSON written by `writeAudit` (never a raw
 * exception or stack trace), so they are safe to pass through directly.
 */
export function toSafeInventoryAuditEntryDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    oldValue: row.old_value ?? null,
    newValue: row.new_value ?? null,
    reason: row.reason ?? null,
    source: row.source,
    createdAt: row.created_at,
  }
}
