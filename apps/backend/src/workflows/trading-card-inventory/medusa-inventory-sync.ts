import type { IInventoryService, IStockLocationService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { MEDUSA_SYNC_ERROR_CATEGORY, type MedusaSyncErrorCategory } from "../../modules/trading-card-inventory/types"
import { resolveConfiguredMedusaStockLocationId } from "./medusa-inventory-sync-config"

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
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)

  let locationId: string
  const configuredLocationId = resolveConfiguredMedusaStockLocationId()
  if (configuredLocationId) {
    try {
      const location = await stockLocationService.retrieveStockLocation(configuredLocationId)
      locationId = location.id
    } catch (error) {
      console.error(`[trading-card-inventory] configured stock location ${configuredLocationId} failed to resolve`, error)
      return failed(
        attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.INVALID_CONFIGURED_STOCK_LOCATION,
        "The configured Medusa stock location could not be resolved."
      )
    }
  } else {
    const locations = await stockLocationService.listStockLocations({})
    if (locations.length === 0) {
      return failed(attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.NO_STOCK_LOCATION, "No Medusa stock location exists.")
    }
    if (locations.length > 1) {
      return failed(
        attemptToken, MEDUSA_SYNC_ERROR_CATEGORY.AMBIGUOUS_STOCK_LOCATION,
        "Multiple Medusa stock locations exist; set TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID to disambiguate."
      )
    }
    locationId = locations[0].id
  }

  // NB: `product_variant.inventory_items` resolves the ProductVariant↔InventoryItem
  // *link pivot* rows, not InventoryItemDTOs — each pivot's own `id` is a
  // `pvitem_...` id, unrelated to the actual inventory item. The real
  // inventory item id is the pivot's `inventory_item_id` foreign key.
  // Verified against a real seeded MedusaApp instance, not inferred from docs.
  const { data: linkedVariants } = await query.graph({
    entity: "trading_card_variant",
    fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
    filters: { id: input.tradingCardVariantId },
  })
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
      await inventoryService.createInventoryLevels([
        { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: input.proposedQuantity },
      ])
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
