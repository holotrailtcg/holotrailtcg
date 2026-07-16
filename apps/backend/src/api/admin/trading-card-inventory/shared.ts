import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../../modules/trading-card-inventory/service"
import { INVENTORY_PROVIDER, INVENTORY_SOURCE_STATUS } from "../../../modules/trading-card-inventory/types"

export function tradingCardInventoryService(req: MedusaRequest): TradingCardInventoryModuleService {
  return req.scope.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
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
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The inventory data could not be loaded.")
  }
}

export async function safeAdminWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (error instanceof MedusaError) throw error
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
