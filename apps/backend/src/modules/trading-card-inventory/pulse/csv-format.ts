import { MedusaError } from "@medusajs/framework/utils"
import { PULSE_EXPECTED_HEADERS, PULSE_FILE_LIMITS, PULSE_OPTIONAL_HEADERS } from "./types"

const BOM = "﻿"

/** Strictly decodes a buffer as UTF-8, rejecting undecodable bytes rather than silently corrupting text (per spec: "reject files with undecodable or ambiguous text"). Trims an optional leading BOM. */
export function decodeUtf8Strict(buffer: Buffer): string {
  if (buffer.length > PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "File exceeds the maximum allowed size")
  }
  if (buffer.includes(0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "File contains null bytes and cannot be processed")
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "File is not valid UTF-8 text")
  }
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

export interface HeaderValidationResult {
  ok: boolean
  missing: string[]
  duplicate: string[]
  unsupported: string[]
  normalizedHeaders: string[]
}

/**
 * Accepts the documented header set regardless of column order (order is
 * not treated as significant — Pulse exports are column-name driven, and
 * requiring an exact order would be a brittle, undocumented extra
 * constraint). Harmless surrounding whitespace on a header cell is trimmed
 * before comparison; the header *names* themselves are matched exactly
 * (case-sensitive) — no fuzzy/misspelling tolerance for the commercial
 * fields, per spec. `PULSE_OPTIONAL_HEADERS` columns are tolerated if
 * present but never required — see its doc comment for why.
 */
export function validateHeaders(rawHeaders: string[]): HeaderValidationResult {
  const normalized = rawHeaders.map((header) => header.trim())
  const expected = new Set<string>([...PULSE_EXPECTED_HEADERS, ...PULSE_OPTIONAL_HEADERS])
  const seen = new Map<string, number>()
  const duplicate: string[] = []
  for (const header of normalized) {
    const count = (seen.get(header) ?? 0) + 1
    seen.set(header, count)
    if (count === 2) duplicate.push(header)
  }
  const missing = PULSE_EXPECTED_HEADERS.filter((header) => !seen.has(header))
  const unsupported = [...seen.keys()].filter((header) => !expected.has(header))
  return {
    ok: missing.length === 0 && duplicate.length === 0 && unsupported.length === 0,
    missing, duplicate, unsupported, normalizedHeaders: normalized,
  }
}
