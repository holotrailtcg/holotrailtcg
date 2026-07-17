/**
 * Narrow reader for `TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID`, mirroring
 * the pattern in `modules/newsletter/lifecycle/config.ts`. An unset value is
 * valid (falls back to auto-pick-if-exactly-one in `medusa-inventory-sync.ts`);
 * an explicitly-set-but-blank value is treated the same as unset.
 */
export function resolveConfiguredMedusaStockLocationId(): string | null {
  const raw = process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed === "" ? null : trimmed
}
