import type { IStockLocationService, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { MEDUSA_SYNC_ERROR_CATEGORY, type MedusaSyncErrorCategory } from "../../modules/trading-card-inventory/types"

/**
 * Narrow reader for `TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID`, mirroring
 * the pattern in `modules/newsletter/lifecycle/config.ts`. An unset value is
 * valid (falls back to auto-pick-if-exactly-one in `resolveMedusaStockLocationId`);
 * an explicitly-set-but-blank value is treated the same as unset.
 */
export function resolveConfiguredMedusaStockLocationId(): string | null {
  const raw = process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed === "" ? null : trimmed
}

export type ResolveMedusaStockLocationResult =
  | { outcome: "RESOLVED"; locationId: string }
  | { outcome: "FAILED"; category: MedusaSyncErrorCategory; message: string }

/**
 * The single, authoritative Stage 5B.2 stock-location resolution policy for
 * every place this module writes Medusa inventory: prefer the explicitly
 * configured location (`TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID`);
 * otherwise auto-pick only when exactly one Medusa stock location exists.
 * Never silently defaults to "the first location found" when more than one
 * exists, and never invents a new location. Both
 * `syncInventoryProposalToMedusa` (Stage 5B.2) and
 * `createCardFromInventoryRowWorkflow` (Stage 5B.3) resolve the location
 * through this one function so the policy can never diverge between them.
 */
export async function resolveMedusaStockLocationId(container: MedusaContainer): Promise<ResolveMedusaStockLocationResult> {
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const configuredLocationId = resolveConfiguredMedusaStockLocationId()

  if (configuredLocationId) {
    try {
      const location = await stockLocationService.retrieveStockLocation(configuredLocationId)
      return { outcome: "RESOLVED", locationId: location.id }
    } catch (error) {
      console.error(`[trading-card-inventory] configured stock location ${configuredLocationId} failed to resolve`, error)
      return {
        outcome: "FAILED", category: MEDUSA_SYNC_ERROR_CATEGORY.INVALID_CONFIGURED_STOCK_LOCATION,
        message: "The configured Medusa stock location could not be resolved.",
      }
    }
  }

  let locations: Awaited<ReturnType<IStockLocationService["listStockLocations"]>>
  try {
    locations = await stockLocationService.listStockLocations({})
  } catch (error) {
    console.error("[trading-card-inventory] failed to list Medusa stock locations", error)
    return { outcome: "FAILED", category: MEDUSA_SYNC_ERROR_CATEGORY.MEDUSA_DEPENDENCY_FAILED, message: "Failed to resolve the Medusa stock location." }
  }
  if (locations.length === 0) {
    return { outcome: "FAILED", category: MEDUSA_SYNC_ERROR_CATEGORY.NO_STOCK_LOCATION, message: "No Medusa stock location exists." }
  }
  if (locations.length > 1) {
    return {
      outcome: "FAILED", category: MEDUSA_SYNC_ERROR_CATEGORY.AMBIGUOUS_STOCK_LOCATION,
      message: "Multiple Medusa stock locations exist; set TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID to disambiguate.",
    }
  }
  return { outcome: "RESOLVED", locationId: locations[0].id }
}
