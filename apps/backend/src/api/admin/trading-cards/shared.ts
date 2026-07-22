import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import type TradingCardsModuleService from "../../../modules/trading-cards/service"
import {
  CARD_CONDITION, CARD_FINISH, CARD_GAME, CARD_LANGUAGE, EXTERNAL_PROVIDER, MAX_CARD_IMAGE_BYTE_SIZE, SPECIAL_TREATMENT,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "../../../modules/trading-cards/types"
import { resolveR2Config } from "../../../modules/trading-cards/images/r2-config"
import { CARD_NUMBER_PATTERN } from "../../../modules/trading-cards/identity/card-number"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../../modules/trading-card-inventory/service"
import { EBAY_INTEGRATION_MODULE } from "../../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../../modules/ebay-integration/service"

export function tradingCardsService(req: MedusaRequest): TradingCardsModuleService {
  return req.scope.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
}

export function tradingCardInventoryService(req: MedusaRequest): TradingCardInventoryModuleService {
  return req.scope.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
}

export function ebayIntegrationService(req: MedusaRequest): EbayIntegrationModuleService {
  return req.scope.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
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
 * A workflow's `.run()` rethrows a failed step's error after round-tripping
 * it through the transaction orchestrator's own checkpoint/state handling,
 * which does not preserve the original error's prototype chain — a plain
 * `error instanceof MedusaError` is `false` for an error a workflow step
 * threw, even for genuine `MedusaError`s (including subclasses like
 * `CatalogueIntegrityError`), so `read`/`write` callers that run workflows
 * would otherwise have their specific error message silently replaced by
 * the generic fallback below. `MedusaError.isMedusaError` duck-types on the
 * error's own shape instead of its prototype, so it survives that
 * round-trip.
 */
function isMedusaError(error: unknown): error is MedusaError {
  return error instanceof MedusaError || MedusaError.isMedusaError(error)
}

export async function safeAdminRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isMedusaError(error)) throw error
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The card image data could not be loaded.")
  }
}

export async function safeAdminWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (isMedusaError(error)) throw error
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The card image action could not be completed.")
  }
}

export const variantIdParamsSchema = z.object({ variantId: z.string().min(1) })
export const imageIdParamsSchema = z.object({ imageId: z.string().min(1) })
export const tradingCardIdParamsSchema = z.object({ tradingCardId: z.string().min(1) })

/** Query for `GET /admin/trading-cards/variants/images` — a comma-separated list of variant ids. */
export const variantThumbnailsQuerySchema = z.object({
  variantIds: z.string().min(1).transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean)).pipe(z.array(z.string()).min(1).max(200)),
}).strict()

export const beginUploadBodySchema = z.object({
  originalFilename: z.string().min(1).max(255),
  declaredMimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
  declaredByteSize: z.number().int().positive().max(MAX_CARD_IMAGE_BYTE_SIZE),
})

export const reorderBodySchema = z.object({
  orderedImageIds: z.array(z.string().min(1)).min(1),
}).strict()

export const focalPointBodySchema = z.object({
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
}).strict()

export const inventoryProposalIdParamsSchema = z.object({ inventoryProposalId: z.string().min(1) })

/**
 * Body for `POST /admin/trading-cards/create-from-inventory-row`. Only
 * reviewer-confirmed/overridden display values are accepted here — the
 * route derives the proposal, snapshot, source language, and parsed Pulse
 * identity (set code / card number) server-side from `inventoryProposalId`
 * alone, never from client-submitted identifiers.
 *
 * `finishConfirmed`/`specialTreatmentConfirmed` must both be `true` —
 * enforced here, not just as a UI affordance (a disabled submit button or a
 * checkbox does nothing to stop a direct API call). This endpoint only ever
 * exists because a human reviewer is confirming a card creation; there is no
 * legitimate automated caller for it, so an unconfirmed request is always a
 * bypass attempt or a client bug, never a valid use case. Because neither
 * flag is ever persisted or reused across requests, there is no stored
 * confirmation state that could go stale — every request must carry its own
 * fresh `true` values or it is rejected outright.
 *
 * `cardNumber` is validated against the same `CARD_NUMBER_PATTERN` that
 * `cardNumberForms` (the single source of truth used by every card-creation
 * path) enforces server-side, so a malformed value is rejected here with a
 * clean 400 before any workflow/database round-trip, rather than surfacing
 * as an opaque failure partway through card creation.
 */
export const createCardFromInventoryRowBodySchema = z.object({
  inventoryProposalId: z.string().min(1),
  cardSetDisplayName: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  cardNumber: z.string().trim().min(1).max(64).regex(CARD_NUMBER_PATTERN, "Card number is not a recognised format."),
  rarityRaw: z.string().trim().max(255).nullish(),
  condition: z.enum(Object.values(CARD_CONDITION) as [string, ...string[]]),
  finish: z.enum(Object.values(CARD_FINISH) as [string, ...string[]]),
  specialTreatment: z.enum(Object.values(SPECIAL_TREATMENT) as [string, ...string[]]),
  finishConfirmed: z.literal(true, { message: "The finish must be explicitly confirmed before a card can be created." }),
  specialTreatmentConfirmed: z.literal(true, { message: "The special treatment must be explicitly confirmed before a card can be created." }),
}).strict()

export { CARD_GAME, CARD_LANGUAGE }

export const unmappedSetCodesQuerySchema = z.object({
  snapshotId: z.string().min(1),
}).strict()

export const suggestSetMappingQuerySchema = z.object({
  providerSetCode: z.string().trim().min(1).max(64),
  language: z.enum(Object.values(CARD_LANGUAGE) as [string, ...string[]]),
}).strict()

/**
 * Fills gaps in a `trading_card` row's own display fields using the most
 * recently accepted (APPROVED or APPLIED) TCGdex enrichment proposal for
 * that card, without ever calling TCGdex live.
 *
 * `applyApprovedEnrichmentProposal` (see `service.ts`) only copies an
 * accepted proposal's `name`/`rarity*` fields onto `trading_card` once a
 * reviewer has taken the separate "apply" action, and only copies the
 * rarity fields at all when the proposal's rarity mapped cleanly
 * (`rarityCandidate.status === "MAPPED"`). A proposal that is merely
 * `APPROVED` (accepted, but not yet applied) therefore is not reflected on
 * `trading_card` yet, even though the match itself has already been
 * accepted. This only ever *fills nulls* — it never overrides a
 * `trading_card` field that already has a value, so it can't contradict a
 * deliberate manual edit or a later, different accepted match.
 */
export async function fillFromAcceptedTcgdexProposal(
  service: TradingCardsModuleService,
  cardFields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tradingCardId = cardFields.id
  if (typeof tradingCardId !== "string" || !tradingCardId) return cardFields

  const needsName = !cardFields.name
  const needsRarity = !cardFields.rarity
  if (!needsName && !needsRarity) return cardFields

  const [proposal] = await service.listTcgDexEnrichmentProposals(
    { trading_card_id: tradingCardId, review_status: ["APPROVED", "APPLIED"] },
    { order: { created_at: "DESC" }, take: 1 },
  )
  const snapshot = proposal?.snapshot as Record<string, unknown> | undefined
  if (!snapshot) return cardFields

  const filled = { ...cardFields }
  if (needsName && typeof snapshot.name === "string" && snapshot.name) {
    filled.name = snapshot.name
  }
  const rarityCandidate = snapshot.rarityCandidate as
    | { status?: string; rarity?: unknown; iconKey?: unknown; providerValue?: unknown }
    | undefined
  if (needsRarity && rarityCandidate?.status === "MAPPED") {
    filled.rarity = rarityCandidate.rarity ?? filled.rarity
    filled.rarity_icon_key = filled.rarity_icon_key ?? rarityCandidate.iconKey ?? null
    filled.rarity_raw = filled.rarity_raw ?? rarityCandidate.providerValue ?? null
  }
  return filled
}

export interface EbayCategoryView { name: string; path: string }

/**
 * Resolves the most recently *confirmed* eBay Store category for a trading
 * card variant, via the most recent `inventory_proposal` row for that
 * variant with a non-null `confirmed_ebay_store_category_id` — the only
 * signal that a category has actually been confirmed (see
 * `POST /admin/trading-card-inventory/proposals/:id/category`), as opposed
 * to merely computed/proposed. Deliberately does not re-run rule evaluation
 * — this reflects what was actually confirmed at import time, not a live
 * recomputation that could disagree with it. Returns `null` if no
 * confirmed proposal exists yet for this variant.
 */
export async function loadConfirmedEbayCategory(
  inventoryService: TradingCardInventoryModuleService,
  ebayService: EbayIntegrationModuleService,
  tradingCardVariantId: string,
): Promise<EbayCategoryView | null> {
  const [proposal] = await inventoryService.listInventoryProposals(
    { trading_card_variant_id: tradingCardVariantId, confirmed_ebay_store_category_id: { $ne: null } },
    { order: { created_at: "DESC" }, take: 1 },
  )
  const categoryId = (proposal as { confirmed_ebay_store_category_id?: string | null } | undefined)?.confirmed_ebay_store_category_id
  if (!categoryId) return null

  const [category] = await ebayService.listEbayStoreCategories({ id: [categoryId] }, { take: 1 })
  if (!category) return null
  return { name: (category as { name: string }).name, path: (category as { path: string }).path }
}

export interface TcgdexSnapshotExtras {
  illustrator: string | null
  types: string[] | null
  variants: { normal: boolean; reverse: boolean; holo: boolean; firstEdition: boolean } | null
}

/**
 * Surfaces extra TCGdex-sourced display data that has never been copied onto
 * the `trading_card` row (see `applyApprovedEnrichmentProposal` in
 * `service.ts`, which only ever copies `name`/`rarity*`): the illustrator,
 * energy types, and which finish variants (normal/reverse holo/holo/1st
 * edition) TCGdex records as existing for this print. Read-only, sourced
 * from the same accepted (APPROVED/APPLIED) proposal snapshot
 * `fillFromAcceptedTcgdexProposal` uses — never a live TCGdex call.
 *
 * This is deliberately a separate concept from `trading_card_variant.finish`
 * (the reviewer-confirmed finish Holo Trail is actually selling): TCGdex's
 * `variants` flags describe which finishes exist for the print in general,
 * not which one a specific physical card in stock is.
 */
export async function loadTcgdexSnapshotExtras(
  service: TradingCardsModuleService, tradingCardId: string,
): Promise<TcgdexSnapshotExtras | null> {
  const [proposal] = await service.listTcgDexEnrichmentProposals(
    { trading_card_id: tradingCardId, review_status: ["APPROVED", "APPLIED"] },
    { order: { created_at: "DESC" }, take: 1 },
  )
  const snapshot = proposal?.snapshot as Record<string, unknown> | undefined
  if (!snapshot) return null

  return {
    illustrator: typeof snapshot.illustrator === "string" ? snapshot.illustrator : null,
    types: Array.isArray(snapshot.types) ? (snapshot.types as string[]) : null,
    variants: (snapshot.variants && typeof snapshot.variants === "object")
      ? (snapshot.variants as TcgdexSnapshotExtras["variants"])
      : null,
  }
}

export const cardSetsQuerySchema = z.object({
  language: z.enum(Object.values(CARD_LANGUAGE) as [string, ...string[]]).optional(),
}).strict()

export const createProviderSetMappingBodySchema = z.object({
  provider: z.enum(Object.values(EXTERNAL_PROVIDER) as [string, ...string[]]),
  game: z.enum(Object.values(CARD_GAME) as [string, ...string[]]),
  language: z.enum(Object.values(CARD_LANGUAGE) as [string, ...string[]]),
  providerSetCode: z.string().trim().min(1).max(64),
  tcgdexSetId: z.string().trim().min(1).max(64),
}).strict()

/**
 * The Admin-safe view of a `CardImage` row. Explicitly excludes
 * `staging_object_key`/`final_object_key` (internal storage detail —
 * callers get a usable URL instead), `sha256_hash`, and `uploaded_by`.
 */
export async function toSafeCardImageDto(service: TradingCardsModuleService, row: Record<string, unknown>) {
  const config = resolveR2Config()
  const imageUrl = row.final_object_key && config.enabled
    ? await service.deriveCardImagePublicUrl({
      publicBaseUrl: config.publicBaseUrl, objectKey: row.final_object_key as string,
    })
    : null
  return {
    id: row.id,
    status: row.status,
    tradingCardVariantId: row.trading_card_variant_id,
    originalFilename: row.original_filename,
    confirmedMimeType: row.confirmed_mime_type ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    sortOrder: row.sort_order,
    focalX: row.focal_x,
    focalY: row.focal_y,
    imageUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
