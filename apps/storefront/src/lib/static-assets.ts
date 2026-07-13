/**
 * Genuine static/framework paths that must bypass all middleware policy
 * (coming-soon gating, country routing, newsletter token handling) —
 * matched narrowly by real file/directory name, never by extension alone,
 * since an extension-based check can also match application routes (e.g.
 * `/gb/products/card.v2`).
 *
 * `_next/*` is handled separately in `middleware.ts` (existing defence in
 * depth alongside `config.matcher`) and is not duplicated here.
 */
const STATIC_ASSET_PATTERNS = [
  /^\/favicon\.ico$/,
  /^\/opengraph-image\.jpg$/,
  /^\/twitter-image\.jpg$/,
  /^\/(?:brand|energy-icons|favicon_io|images|rarity-icons|variant-icons)\/.+$/,
]

export function isStaticAssetPath(pathname: string): boolean {
  return STATIC_ASSET_PATTERNS.some((pattern) => pattern.test(pathname))
}
