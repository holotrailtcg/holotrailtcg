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
 * anything with unexpected symbols, thousands separators are stripped
 * (Pulse exports have not been observed to use them, but stripping is
 * harmless and defensive), and caps fractional precision at 6 places to
 * match the reconciliation engine's own minimum output scale.
 */
export function parseMoneyField(raw: string | undefined | null, options: ParseMoneyOptions = {}): ParsedMoney {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return { status: "missing", canonical: null }

  const withoutSymbol = trimmed.replace(CURRENCY_SYMBOL_PATTERN, "").trim()
  const withoutCommas = withoutSymbol.replace(/,/g, "")
  const negative = withoutCommas.startsWith("-")
  const magnitude = negative ? withoutCommas.slice(1) : withoutCommas

  if (!/^\d+(\.\d+)?$/.test(magnitude)) return { status: "invalid", canonical: null }
  const [, fraction = ""] = magnitude.split(".")
  if (fraction.length > MAX_DECIMAL_PLACES) return { status: "invalid", canonical: null }
  if (negative && !options.allowNegative) return { status: "invalid", canonical: null }

  const canonical = negative ? `-${magnitude}` : magnitude
  const isZero = Number.parseFloat(magnitude) === 0
  return { status: isZero && !negative ? "zero" : "value", canonical }
}
