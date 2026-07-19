export interface CardNumberForms {
  original: string
  normalised: string
}

export function normaliseComparisonText(value: string): string {
  return value.normalize("NFC").trim()
}

/**
 * The authoritative card-number shape, applied everywhere a card number is
 * accepted (Pulse-derived or reviewer-entered — `cardNumberForms` is the one
 * function every creation path funnels through). Deliberately permissive
 * about which real-world Pokémon numbering schemes it accepts, but strict
 * about the *shape*:
 *
 *   [letters]digits[letter](/digits)
 *
 * - an optional alphabetic set/promo prefix (`SWSH`, `TG`, `GG`, `SM`, …)
 * - a required digit run — leading zeros are significant and never stripped
 *   (e.g. "025" and "25" are different card-number strings; this pattern
 *   never reformats them, it only validates and case-folds)
 * - an optional single trailing letter suffix for alternate-art variants
 *   (e.g. "025a")
 * - an optional "/digits" denominator (Pulse's own format includes this,
 *   e.g. "044/072")
 *
 * Anything else — embedded whitespace, multiple slashes, punctuation,
 * multiple suffix letters, a non-numeric denominator — is rejected as
 * malformed/ambiguous rather than silently accepted or guessed at.
 */
export const CARD_NUMBER_PATTERN = /^[A-Za-z]*[0-9]+[A-Za-z]?(?:\/[0-9]+)?$/

/**
 * The pure transform every `card_number_normalised` value in the database —
 * old algorithm or new — is derived from: trim+NFC, drop the denominator,
 * uppercase-fold. Deliberately never throws and never validates shape, so
 * it is safe to call on *any* string, including untrusted, unvalidated text
 * that never passed through `cardNumberForms`'s format check (e.g. Pulse's
 * own `cardNumberCandidate`, which is raw untrusted CSV/product-id text —
 * see `service.ts#findVariantCandidatesForPulseMatch`). This is what makes
 * it safe to use as the single normalisation both writers (via
 * `cardNumberForms`, after validation) and lookup/matching readers (without
 * validation) share — the same function Migration20260718160000 reproduces
 * in SQL to re-normalise pre-existing rows written before this policy
 * shipped.
 */
export function normaliseCardNumberComparisonForm(value: string): string {
  const [numberWithoutDenominator] = normaliseComparisonText(value).split("/")
  return numberWithoutDenominator.toUpperCase()
}

export function cardNumberForms(value: string): CardNumberForms {
  if (typeof value !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Card number must be a string")
  }
  const trimmed = normaliseComparisonText(value)
  if (!trimmed) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Card number must not be empty")
  }
  if (!CARD_NUMBER_PATTERN.test(trimmed)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Card number "${trimmed}" is not a recognised format — expected an optional letter prefix, digits (leading zeros preserved), an optional single letter suffix, and an optional /denominator (e.g. "025", "025a", "SWSH123", "044/072").`,
    )
  }
  // `original` stores the trimmed, NFC-normalised representation — not the
  // raw `value` — since there is no documented audit requirement to retain
  // incidental surrounding whitespace a reviewer's input field happened to
  // carry, and storing it verbatim would let cosmetic whitespace differences
  // leak into the display column (`card_number`) despite two such inputs
  // being the exact same card.
  return { original: trimmed, normalised: normaliseCardNumberComparisonForm(trimmed) }
}
import { MedusaError } from "@medusajs/framework/utils"
