import { parseProductId } from "./product-id"
import { parseMoneyField } from "./money"
import { parseQuantityField } from "./quantity"
import { resolveCondition } from "./condition"
import { inferProviderLanguageHint, resolveRowLanguage } from "./language"
import { mapMaterial } from "./material-mapping"
import { mapRarity } from "./rarity-mapping"
import { PULSE_FILE_LIMITS } from "./types"
import type { ParsedPulseRow, RowDiagnostic } from "./types"

export interface PulseCsvRecord {
  [header: string]: string | undefined
}

const RAW_FIELD_MAX_LENGTH = 300

function bounded(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return null
  return trimmed.slice(0, RAW_FIELD_MAX_LENGTH)
}

function isBlankRow(record: PulseCsvRecord): boolean {
  return Object.values(record).every((value) => !value || value.trim() === "")
}

/**
 * Parses one Pulse CSV data row into a bounded, immutable `ParsedPulseRow`.
 * Pure function — no I/O, no database access. `sourceLanguage` is the
 * selected inventory source's configured language (the authority; see
 * `language.ts`), or null for a mixed/unspecified source.
 */
export function parsePulseRow(record: PulseCsvRecord, rowNumber: number, sourceLanguage: string | null): ParsedPulseRow {
  const diagnostics: RowDiagnostic[] = []
  const addDiagnostic = (code: string, severity: RowDiagnostic["severity"], message: string, fieldRef?: string) =>
    diagnostics.push({ rowNumber, phase: "PARSE", code, severity, fieldRef: fieldRef ?? null, message })

  if (isBlankRow(record)) {
    return {
      rowNumber, outcome: "SKIPPED", providerReference: "", quantity: null, currencyCode: null,
      unitAcquisitionCost: null, unitMarketPrice: null, unitSellingPrice: null, conditionSource: null,
      conditionCandidate: null, conditionUnknownToken: null, finishCandidate: null, specialTreatmentCandidate: null, rarityCandidate: null,
      rarityRaw: null, languageConflict: false, languageCandidate: sourceLanguage, cardNumberCandidate: null,
      setCodeCandidate: null, gradedCardDetected: false, rawFields: {},
      diagnostics: [{ rowNumber, phase: "PARSE", code: "BLANK_ROW", severity: "INFO", fieldRef: null, message: "Row has no populated fields and was skipped." }],
    }
  }

  for (const [field, value] of Object.entries(record)) {
    if ((value ?? "").length > PULSE_FILE_LIMITS.MAX_FIELD_LENGTH) {
      addDiagnostic("OVERSIZED_FIELD", "ERROR", `Field exceeds the maximum allowed length of ${PULSE_FILE_LIMITS.MAX_FIELD_LENGTH} characters.`, field)
    }
  }

  const productId = parseProductId(record["Product ID"] ?? "")
  if (!productId.wellFormed) {
    addDiagnostic("MALFORMED_PRODUCT_ID", "ERROR", "Product ID could not be parsed into a provider prefix, set code and card number.", "Product ID")
  }

  const quantity = parseQuantityField(record["Quantity"])
  if (quantity.status === "invalid") addDiagnostic("INVALID_QUANTITY", "ERROR", "Quantity is not a valid non-negative whole number within the supported range.", "Quantity")
  if (quantity.status === "missing") addDiagnostic("MISSING_QUANTITY", "ERROR", "Quantity is required.", "Quantity")

  const avgCost = parseMoneyField(record["Avg Cost"])
  const marketPrice = parseMoneyField(record["Market Price"])
  const stickerPrice = parseMoneyField(record["Sticker Price"])
  for (const [field, parsed] of [["Avg Cost", avgCost], ["Market Price", marketPrice], ["Sticker Price", stickerPrice]] as const) {
    if (parsed.status === "invalid") addDiagnostic("INVALID_MONEY", "ERROR", `${field} is not a valid non-negative monetary amount.`, field)
  }
  const anyMoneyPresent = [avgCost, marketPrice, stickerPrice].some((parsed) => parsed.status === "value" || parsed.status === "zero")

  // A cleanly-absent condition token is standard for this provider's export
  // format (it defaults to Near Mint, changeable later by the reviewer) and is
  // deliberately not surfaced as a diagnostic — only a genuinely unrecognised
  // token is a true anomaly worth flagging.
  const condition = resolveCondition(productId.conditionCandidate)
  if (productId.conditionCandidate && condition.unknownToken) {
    addDiagnostic("UNKNOWN_CONDITION_TOKEN", "WARNING", `Condition token "${condition.unknownToken}" is not recognised; defaulted to Near Mint pending review.`, "Product ID")
  }

  const languageHint = inferProviderLanguageHint(productId.setCodeCandidate)
  const language = resolveRowLanguage(sourceLanguage, languageHint)
  if (language.conflict) {
    addDiagnostic("LANGUAGE_CONFLICT", "WARNING", `Provider reference suggests language "${languageHint}", which conflicts with the source's configured language "${sourceLanguage}".`, "Product ID")
  }
  if (!language.language) {
    addDiagnostic("LANGUAGE_UNRESOLVED", "WARNING", "No source language is configured and no provider language hint was present.", "Set")
  }

  const material = mapMaterial(record["Material"])
  if (!material.recognized) {
    addDiagnostic("UNRECOGNIZED_MATERIAL", "WARNING", "Material value did not map to a known finish/special-treatment combination.", "Material")
  }

  const rarity = mapRarity(record["Rarity"])
  if (rarity.raw && !rarity.candidate) {
    addDiagnostic("UNMAPPED_RARITY", "INFO", "Rarity value has no safe canonical mapping and is pending review.", "Rarity")
  }

  const gradedCardDetected = Boolean((record["Graded By"] ?? "").trim() || (record["Grade"] ?? "").trim())
  if (gradedCardDetected) {
    addDiagnostic("GRADED_CARD_UNSUPPORTED", "WARNING", "Graded-card fields are populated; Stage 3 has no graded-card model yet, so this row is review-required.", "Graded By")
  }

  const hasFatalError = diagnostics.some((diagnostic) => diagnostic.severity === "ERROR")
  const needsReview =
    !material.recognized || (Boolean(rarity.raw) && !rarity.candidate) || language.conflict ||
    !language.language || gradedCardDetected || Boolean(condition.unknownToken)

  // A cleanly-absent condition token (no token stated at all, defaulted to Near
  // Mint) is standard for this provider's export format, not a warning-worthy
  // event — only a genuinely missing price signal still downgrades the outcome.
  const outcome = hasFatalError
    ? "INVALID"
    : needsReview
      ? "REVIEW_REQUIRED"
      : !anyMoneyPresent
        ? "VALID_WITH_WARNINGS"
        : "VALID"

  return {
    rowNumber,
    outcome,
    providerReference: productId.raw,
    quantity: quantity.value,
    currencyCode: anyMoneyPresent ? "GBP" : null,
    unitAcquisitionCost: avgCost.status === "value" || avgCost.status === "zero" ? avgCost.canonical : null,
    unitMarketPrice: marketPrice.status === "value" || marketPrice.status === "zero" ? marketPrice.canonical : null,
    unitSellingPrice: stickerPrice.status === "value" || stickerPrice.status === "zero" ? stickerPrice.canonical : null,
    conditionSource: condition.source,
    conditionCandidate: condition.condition,
    conditionUnknownToken: condition.unknownToken,
    finishCandidate: material.finishCandidate,
    specialTreatmentCandidate: material.specialTreatmentCandidate,
    rarityCandidate: rarity.candidate,
    rarityRaw: rarity.raw,
    languageConflict: language.conflict,
    languageCandidate: language.language,
    cardNumberCandidate: productId.cardNumberCandidate,
    setCodeCandidate: productId.setCodeCandidate,
    gradedCardDetected,
    rawFields: {
      productName: bounded(record["Product Name"]),
      setName: bounded(record["Set"]),
      cardNumber: bounded(record["Card Number"]),
      material: bounded(record["Material"]),
      promoInfo: bounded(record["Promo Info"]),
      itemType: bounded(record["Item Type"]),
      gradedBy: bounded(record["Graded By"]),
      grade: bounded(record["Grade"]),
    },
    diagnostics,
  }
}
