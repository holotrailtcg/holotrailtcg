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
