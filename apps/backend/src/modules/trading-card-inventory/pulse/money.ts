import type { ParsedMoney } from "./types"

const CURRENCY_SYMBOL_PATTERN = /^[£$€¥]/
const MAX_DECIMAL_PLACES = 6

export interface ParseMoneyOptions {
  /** Only Profit-style diagnostic fields legitimately go negative; the authoritative cost/price fields never do. */
  allowNegative?: boolean
}

/**
 * Cleans and validates a Pulse money cell (e.g. `£1.00`, `£-0.05`, blank) into
 * Stage 5A.2's decimal-string grammar. Blank is tracked as "missing", never
 * silently coerced to zero; `£0.00` is a legitimate "zero" value. Rejects
 * anything with unexpected symbols, validates conventional thousands
 * grouping before stripping separators, and caps fractional precision at 6 places to
 * match the reconciliation engine's own minimum output scale.
 */
export function parseMoneyField(raw: string | undefined | null, options: ParseMoneyOptions = {}): ParsedMoney {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return { status: "missing", canonical: null }

  const withoutSymbol = trimmed.replace(CURRENCY_SYMBOL_PATTERN, "").trim()
  const negative = withoutSymbol.startsWith("-")
  const unsigned = negative ? withoutSymbol.slice(1) : withoutSymbol
  if (unsigned.includes(",") && !/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(unsigned)) {
    return { status: "invalid", canonical: null }
  }
  const magnitude = unsigned.replace(/,/g, "")

  if (!/^\d+(\.\d+)?$/.test(magnitude)) return { status: "invalid", canonical: null }
  const [, fraction = ""] = magnitude.split(".")
  if (fraction.length > MAX_DECIMAL_PLACES) return { status: "invalid", canonical: null }
  if (negative && !options.allowNegative) return { status: "invalid", canonical: null }

  const canonical = negative ? `-${magnitude}` : magnitude
  const isZero = Number.parseFloat(magnitude) === 0
  return { status: isZero && !negative ? "zero" : "value", canonical }
}
