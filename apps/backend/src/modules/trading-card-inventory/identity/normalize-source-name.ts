/**
 * Duplicate-source protection compares names case-insensitively with
 * whitespace collapsed, e.g. " [ME]  eBay Stock " and "[me] ebay stock"
 * normalise to the same value. Mirrors the trading-cards SKU convention of
 * storing a normalised, uniquely-indexed column rather than a Postgres
 * expression index.
 */
export function normalizeSourceName(displayName: string): string {
  return displayName.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase()
}
