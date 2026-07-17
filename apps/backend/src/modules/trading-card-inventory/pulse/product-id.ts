import type { ParsedProductId } from "./types"

/**
 * Parses a Pulse `Product ID` such as `card:swsh4pt5|044/072|Holo|null|null|null`
 * or `card:base3|53/62|null|null|null|null|lp`.
 *
 * Only the first two pipe-delimited segments (provider set code, card
 * number) and a possible trailing condition token are trusted positionally.
 * Everything else — including segment 3 (material, which is also present
 * on its own CSV column and cross-checked there) and any further segments —
 * is treated as opaque, non-canonical diagnostic data: real Pulse exports
 * are observed to sometimes place promo text in a "null" slot, so no
 * position beyond the first two is assumed reliable.
 */
export function parseProductId(raw: string): ParsedProductId {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) {
    return {
      raw: trimmed, wellFormed: false, providerPrefixPresent: false,
      setCodeCandidate: null, cardNumberCandidate: null, materialCandidate: null, conditionCandidate: null, segmentCount: 0,
    }
  }
  const providerPrefixPresent = trimmed.toLowerCase().startsWith("card:")
  const withoutPrefix = providerPrefixPresent ? trimmed.slice("card:".length) : trimmed
  const segments = withoutPrefix.split("|").map((segment) => segment.trim())
  const setCodeCandidate = segments[0] || null
  const cardNumberCandidate = segments[1] || null
  const rawMaterial = segments[2]
  const materialCandidate = rawMaterial && rawMaterial.toLowerCase() !== "null" ? rawMaterial : null
  const lastSegment = segments[segments.length - 1]
  const normalizedLastSegment = lastSegment?.toLowerCase()
  const conditionCandidate =
    segments.length > 6 && normalizedLastSegment && normalizedLastSegment !== "null"
      ? normalizedLastSegment
      : null
  const wellFormed = providerPrefixPresent && Boolean(setCodeCandidate) && Boolean(cardNumberCandidate)
  return {
    raw: trimmed, wellFormed, providerPrefixPresent,
    setCodeCandidate, cardNumberCandidate, materialCandidate, conditionCandidate,
    segmentCount: segments.length,
  }
}
