export type DecimalInput = string | number

interface DecimalParts { coefficient: bigint; scale: number }

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/

export function parseNonNegativeDecimal(value: DecimalInput): DecimalParts {
  const text = typeof value === "number" ? String(value) : value
  const match = DECIMAL_PATTERN.exec(text)
  if (!match) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Invalid non-negative decimal: ${text}`)
  const fraction = match[2] ?? ""
  return { coefficient: BigInt(`${match[1]}${fraction}`), scale: fraction.length }
}

function pow10(exponent: number): bigint { return 10n ** BigInt(exponent) }

export function canonicalDecimal(value: DecimalInput | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const { coefficient, scale } = parseNonNegativeDecimal(value)
  if (scale === 0) return coefficient.toString()
  const padded = coefficient.toString().padStart(scale + 1, "0")
  const result = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, "")
  return result || "0"
}

export function compareDecimals(left: string | null, right: string | null): boolean {
  return left === right
}

/** Calculates sum(unit cost * quantity) / sum(quantity) using BigInt only. */
export function weightedAverage(
  values: Array<{ unitCost: DecimalInput; quantity: number }>,
  minimumScale = 6,
): string | null {
  const nonEmpty = values.filter(({ quantity }) => quantity > 0)
  if (nonEmpty.length === 0) return null
  const parsed = nonEmpty.map(({ unitCost, quantity }) => ({ ...parseNonNegativeDecimal(unitCost), quantity }))
  const inputScale = Math.max(...parsed.map(({ scale }) => scale))
  const totalQuantity = parsed.reduce((sum, { quantity }) => sum + BigInt(quantity), 0n)
  const totalAtInputScale = parsed.reduce(
    (sum, { coefficient, scale, quantity }) =>
      sum + coefficient * pow10(inputScale - scale) * BigInt(quantity),
    0n,
  )
  const outputScale = Math.max(inputScale, minimumScale)
  const scaledNumerator = totalAtInputScale * pow10(outputScale - inputScale)
  const quotient = scaledNumerator / totalQuantity
  const remainder = scaledNumerator % totalQuantity
  const rounded = remainder * 2n >= totalQuantity ? quotient + 1n : quotient
  return canonicalDecimal(`${rounded / pow10(outputScale)}.${(rounded % pow10(outputScale)).toString().padStart(outputScale, "0")}`)
}

export function maxDecimal(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => value !== null)
  if (present.length === 0) return null
  return present.reduce((best, candidate) => {
    const a = parseNonNegativeDecimal(best)
    const b = parseNonNegativeDecimal(candidate)
    const scale = Math.max(a.scale, b.scale)
    return a.coefficient * pow10(scale - a.scale) >= b.coefficient * pow10(scale - b.scale) ? best : candidate
  })
}
import { MedusaError } from "@medusajs/framework/utils"
