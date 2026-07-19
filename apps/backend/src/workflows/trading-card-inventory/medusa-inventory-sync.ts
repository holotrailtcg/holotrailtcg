import type { IInventoryService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, isDuplicateError, MedusaError, Modules } from "@medusajs/framework/utils"
import { MEDUSA_SYNC_ERROR_CATEGORY, type MedusaSyncErrorCategory } from "../../modules/trading-card-inventory/types"
import { resolveMedusaStockLocationId } from "./medusa-inventory-sync-config"

export interface SyncInventoryProposalToMedusaInput {
  proposalId: string
  tradingCardVariantId: string
  proposedQuantity: number
  /** Minted by `TradingCardInventoryModuleService#beginMedusaSyncAttempt` and round-tripped back through `recordMedusaSyncResult`. */
  attemptToken: string
}

export type SyncInventoryProposalToMedusaResult =
  | { outcome: "SYNCED"; attemptToken: string; medusaInventoryItemId: string; medusaStockLocationId: string }
  | { outcome: "FAILED"; attemptToken: string; category: MedusaSyncErrorCategory; message: string }

function failed(attemptToken: string, category: MedusaSyncErrorCategory, message: string): SyncInventoryProposalToMedusaResult {
  return { outcome: "FAILED", attemptToken, category, message }
}

function isNotFound(error: unknown): boolean {
  return error instanceof MedusaError && error.type === MedusaError.Types.NOT_FOUND
}

function isConflict(error: unknown): boolean {
  // Medusa's own inventory module does its own application-level existence
  // check before writing (not solely the DB's unique-constraint violation,
  // which `isDuplicateError`/`DUPLICATE_ERROR` cover as a fallback) and
  // raises `INVALID_DATA` with an "already exists" message when a level for
  // this (inventory_item_id, location_id) pair has already been created —
  // exactly the shape a concurrent winner's create leaves behind for us to
  // observe. Verified directly against a real concurrent-write race, not
  // inferred from Medusa's docs.
  if (error instanceof MedusaError) {
    if (error.type === MedusaError.Types.DUPLICATE_ERROR) return true
    if (error.type === MedusaError.Types.INVALID_DATA && /already exists/i.test(error.message)) return true
  }
  return error instanceof Error && isDuplicateError(error)
}

/**
 * Reflects one locally-APPLIED proposal's authoritative resulting quantity
 * into Medusa's own inventory system — always writing the absolute
 * `stocked_quantity`, never a relative delta, per the confirmed Stage 5B.2
 * design. Never creates, publishes, or alters anything beyond the inventory
 * level itself: no products, prices, images, metadata or sales channels.
 *
 * Every failure path returns a categorized, Admin-safe result — the raw
 * Medusa/driver exception is never persisted or returned, only logged here
 * for operator diagnosis.
 */
export async function syncInventoryProposalToMedusa(
  container: MedusaContainer,
  input: SyncInventoryProposalToMedusaInput
): Promise<SyncInventoryProposalToMedusaResult> {
  const { attemptToken } = input
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)

  const locationResolution = await resolveMedusaStockLocationId(container)
  if (locationResolution.outcome === "FAILED") {
    return failed(attemptToken, locationResolution.category, locationResolution.message)
  }
  const locationId = locationResolution.locationId

  // NB: `product_variant.inventory_items` resolves the ProductVariant↔InventoryItem
  // *link pivot* rows, not InventoryItemDTOs — each pivot's own `id` is a
  // `pvitem_...` id, unrelated to the actual inventory item. The real
  // inventory item id is the pivot's `inventory_item_id` foreign key.
  // Verified against a real seeded MedusaApp instance, not inferred from docs.
  let linkedVariants: Record<string, unknown>[]
  try {
    const result = await query.graph({
      entity: "trading_card_variant",
      fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
      filters: { id: input.tradingCardVariantId },
    })
    linkedVariants = result.data as Record<string, unknown>[]
  } catch (error) {
    console.error(`[trading-card-inventory] failed to resolve Medusa links for variant ${input.tradingCardVariantId}`, error)
    return failed(attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.MEDUSA_DEPENDENCY_FAILED, "Failed to resolve the Medusa inventory link.")
  }
  const productVariant = linkedVariants[0]?.product_variant as
    | { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> | null }
    | null
  if (!productVariant?.id) {
    return failed(attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.NO_PRODUCT_VARIANT_LINK, "This trading card variant has no linked Medusa product variant.")
  }

  const inventoryItemId = productVariant.inventory_items?.[0]?.inventory_item_id
  if (!inventoryItemId) {
    return failed(attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.NO_INVENTORY_ITEM_LINK, "This product variant has no linked Medusa inventory item.")
  }

  let levelExists: boolean
  try {
    await inventoryService.retrieveInventoryLevelByItemAndLocation(inventoryItemId, locationId)
    levelExists = true
  } catch (error) {
    if (!isNotFound(error)) {
      console.error(`[trading-card-inventory] failed to read Medusa inventory level for item ${inventoryItemId}`, error)
      return failed(attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.MEDUSA_LEVEL_READ_FAILED, "Failed to read the current Medusa inventory level.")
    }
    levelExists = false
  }

  try {
    if (levelExists) {
      await inventoryService.updateInventoryLevels([
        { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: input.proposedQuantity },
      ])
    } else {
      try {
        await inventoryService.createInventoryLevels([
          { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: input.proposedQuantity },
        ])
      } catch (createError) {
        // `inventory_level` enforces a unique (inventory_item_id, location_id)
        // pair at the DB layer, so a duplicate row can never actually be
        // created — but a genuinely concurrent sync attempt for the same
        // item+location racing between the read above and this create can
        // legitimately lose that race. Recover by switching to an update
        // rather than surfacing a spurious failure for a level that, by the
        // time this runs, the other attempt has already created.
        if (!isConflict(createError)) throw createError
        await inventoryService.updateInventoryLevels([
          { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: input.proposedQuantity },
        ])
      }
    }
  } catch (error) {
    console.error(`[trading-card-inventory] failed to write Medusa inventory level for item ${inventoryItemId}`, error)
    return failed(
      attemptToken,
      levelExists ? MEDUSA_SYNC_ERROR_CATEGORY.MEDUSA_LEVEL_UPDATE_FAILED : MEDUSA_SYNC_ERROR_CATEGORY.MEDUSA_LEVEL_CREATE_FAILED,
      levelExists ? "Failed to update the Medusa inventory level." : "Failed to create the Medusa inventory level."
    )
  }

  return { outcome: "SYNCED", attemptToken, medusaInventoryItemId: inventoryItemId, medusaStockLocationId: locationId }
}
