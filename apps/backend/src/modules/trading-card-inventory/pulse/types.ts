/**
 * Stage 5B.1: provider-independent Pulse CSV parsing types. Nothing outside
 * this folder should ever see a raw `csv-parse` record or column-index
 * type — every boundary crossing uses these Holo Trail domain types.
 */

/** The exact Pulse export header set, in the documented column order. Order is not treated as significant for acceptance (see csv-format.ts), only the header name set is. */
export const PULSE_EXPECTED_HEADERS = [
  "Product Name", "Set", "Card Number", "Material", "Promo Info", "Rarity", "Graded By", "Grade",
  "Item Type", "Product ID", "Quantity", "Avg Cost", "Market Price", "Sticker Price",
  "Total Cost", "Total Market Value", "Total Sticker Value", "Profit", "Margin %", "Markup vs Market %",
] as const

export const PULSE_FILE_LIMITS = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_ROWS: 50_000,
  MAX_FIELD_LENGTH: 2_000,
} as const

/** Single source of truth for filename/MIME acceptance — imported by both the import workflow and the (future) Admin upload route so validation never drifts between the two. */
export const PULSE_UPLOAD_FILENAME_SUFFIX = ".csv"
export const PULSE_UPLOAD_MIME_ALLOWLIST = ["text/csv", "application/vnd.ms-excel", "application/csv"] as const

export interface RowDiagnostic {
  rowNumber: number
  phase: "PARSE" | "MATCHING"
  code: string
  severity: "INFO" | "WARNING" | "ERROR"
  fieldRef?: string | null
  message: string
}

export const PULSE_MONEY_FIELDS = ["Avg Cost", "Market Price", "Sticker Price"] as const
export type PulseMoneyField = (typeof PULSE_MONEY_FIELDS)[number]

export interface ParsedMoney {
  status: "missing" | "zero" | "value" | "invalid"
  canonical: string | null
}

export interface ParsedProductId {
  raw: string
  wellFormed: boolean
  providerPrefixPresent: boolean
  setCodeCandidate: string | null
  cardNumberCandidate: string | null
  materialCandidate: string | null
  conditionCandidate: string | null
  segmentCount: number
}

export interface MaterialCandidate {
  finishCandidate: string | null
  specialTreatmentCandidate: string | null
  recognized: boolean
}

export interface ConditionResolution {
  condition: string
  source: "EXPLICIT" | "DEFAULTED"
  unknownToken: string | null
}

export interface RarityCandidate {
  candidate: string | null
  raw: string | null
}

export interface LanguageResolution {
  language: string | null
  conflict: boolean
  hint: string | null
}

/** A fully parsed, bounded row — the immutable output of row-parser.ts. Never contains a raw provider payload. */
export interface ParsedPulseRow {
  rowNumber: number
  outcome: "VALID" | "VALID_WITH_WARNINGS" | "REVIEW_REQUIRED" | "INVALID" | "SKIPPED"
  providerReference: string
  quantity: number | null
  currencyCode: string | null
  unitAcquisitionCost: string | null
  unitMarketPrice: string | null
  unitSellingPrice: string | null
  conditionSource: "EXPLICIT" | "DEFAULTED" | null
  conditionCandidate: string | null
  finishCandidate: string | null
  specialTreatmentCandidate: string | null
  rarityCandidate: string | null
  rarityRaw: string | null
  languageConflict: boolean
  languageCandidate: string | null
  cardNumberCandidate: string | null
  setCodeCandidate: string | null
  gradedCardDetected: boolean
  rawFields: Record<string, string | null>
  diagnostics: RowDiagnostic[]
}
