import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import type TradingCardsModuleService from "../../../modules/trading-cards/service"
import {
  CARD_CONDITION, CARD_FINISH, CARD_GAME, CARD_LANGUAGE, MAX_CARD_IMAGE_BYTE_SIZE, SPECIAL_TREATMENT,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "../../../modules/trading-cards/types"
import { resolveR2Config } from "../../../modules/trading-cards/images/r2-config"

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

export async function safeAdminRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof MedusaError) throw error
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The card image data could not be loaded.")
  }
}

export async function safeAdminWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (error instanceof MedusaError) throw error
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The card image action could not be completed.")
  }
}

export const variantIdParamsSchema = z.object({ variantId: z.string().min(1) })
export const imageIdParamsSchema = z.object({ imageId: z.string().min(1) })
export const tradingCardIdParamsSchema = z.object({ tradingCardId: z.string().min(1) })

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
 */
export const createCardFromInventoryRowBodySchema = z.object({
  inventoryProposalId: z.string().min(1),
  cardSetDisplayName: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  cardNumber: z.string().trim().min(1).max(64),
  rarityRaw: z.string().trim().max(255).nullish(),
  condition: z.enum(Object.values(CARD_CONDITION) as [string, ...string[]]),
  finish: z.enum(Object.values(CARD_FINISH) as [string, ...string[]]),
  specialTreatment: z.enum(Object.values(SPECIAL_TREATMENT) as [string, ...string[]]),
  finishConfirmed: z.boolean(),
  specialTreatmentConfirmed: z.boolean(),
}).strict()

export { CARD_GAME, CARD_LANGUAGE }

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
