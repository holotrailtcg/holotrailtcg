/**
 * Routes that remain reachable while `COMING_SOON_MODE` gates the rest of
 * the storefront. This is deliberately an allowlist, not a blocklist of
 * store/product/checkout routes: any route not listed here (including ones
 * added after this stage) is gated automatically, with no maintenance
 * burden per new commerce route.
 *
 * Patterns match the "logical" pathname — the request pathname with any
 * leading `/{countryCode}` segment already stripped — so the same list
 * covers both `/coming-soon` and `/gb/coming-soon`.
 */
const ALLOWLIST = [
  /^\/coming-soon\/?$/,
  /^\/coming-soon\/opengraph-image\/?$/,
  /^\/privacy\/?$/,
  /^\/newsletter\/confirm\/?$/,
  /^\/newsletter\/unsubscribe\/?$/,
]

export function isAllowlistedDuringComingSoon(logicalPath: string): boolean {
  return ALLOWLIST.some((pattern) => pattern.test(logicalPath))
}
