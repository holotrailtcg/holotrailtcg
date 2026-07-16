export const MAX_ROW_QUANTITY = 100_000

export interface ParsedQuantity {
  status: "missing" | "value" | "invalid"
  value: number | null
}

/** Strict integer quantity parsing: no fractions, no NaN/Infinity, no stray symbols, zero preserved. */
export function parseQuantityField(raw: string | undefined | null): ParsedQuantity {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return { status: "missing", value: null }
  if (!/^\d+$/.test(trimmed)) return { status: "invalid", value: null }
  const value = Number.parseInt(trimmed, 10)
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ROW_QUANTITY) return { status: "invalid", value: null }
  return { status: "value", value }
}
