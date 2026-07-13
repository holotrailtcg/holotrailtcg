import { MedusaError } from "@medusajs/framework/utils"

const MAX_FIRST_NAME_LENGTH = 100
const MAX_CONSENT_TEXT_VERSION_LENGTH = 32
const MAX_SOURCE_LENGTH = 64

/**
 * Minimal storage-safety cleaning only — not full public input validation
 * (that lands in Stage 2C.6). Rejects values the database could not
 * legally store; does not parse names, does not strip punctuation, and
 * preserves legitimate Unicode.
 */
export function cleanFirstName(raw: string): string {
  if (typeof raw !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "firstName must be a string"
    )
  }

  const trimmed = raw.trim()

  if (!trimmed) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "firstName must not be empty"
    )
  }

  if (trimmed.length > MAX_FIRST_NAME_LENGTH) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `firstName exceeds ${MAX_FIRST_NAME_LENGTH} characters`
    )
  }

  return trimmed
}

export interface ConsentInput {
  consentTextVersion: string
  consentedAt?: Date
  source: string
}

export interface CleanedConsent {
  consentTextVersion: string
  consentedAt: Date
  source: string
}

/**
 * Requires a non-empty, bounded consent-text version and source, and a
 * valid consent timestamp. `consentedAt` defaults to a server-generated
 * `new Date()` — callers must not pass through a browser-provided
 * timestamp as authoritative; the optional override exists only so tests
 * can assert against a deterministic value.
 */
export function assertConsentInput(input: ConsentInput): CleanedConsent {
  if (typeof input.consentTextVersion !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "consentTextVersion must be a string"
    )
  }
  const consentTextVersion = input.consentTextVersion.trim()
  if (!consentTextVersion) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "consentTextVersion must not be empty"
    )
  }
  if (consentTextVersion.length > MAX_CONSENT_TEXT_VERSION_LENGTH) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `consentTextVersion exceeds ${MAX_CONSENT_TEXT_VERSION_LENGTH} characters`
    )
  }

  if (typeof input.source !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "source must be a string"
    )
  }
  const source = input.source.trim()
  if (!source) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "source must not be empty"
    )
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `source exceeds ${MAX_SOURCE_LENGTH} characters`
    )
  }

  const consentedAt = input.consentedAt ?? new Date()
  if (!(consentedAt instanceof Date) || Number.isNaN(consentedAt.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "consentedAt must be a valid Date"
    )
  }

  return { consentTextVersion, consentedAt, source }
}
