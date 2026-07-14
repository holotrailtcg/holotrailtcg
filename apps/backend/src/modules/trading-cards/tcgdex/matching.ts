import { TCGDEX_ERROR_CODE, TcgDexError } from "./errors"
import { TCGDEX_LANGUAGE, type TcgDexCard, type TcgDexLanguage } from "./types"
import { normalizeTcgdexCard } from "./normalization"
import { TCGDEX_MATCH_CODE, TCGDEX_MATCH_SOURCE, type TcgDexMatchInput, type TcgDexMatchResult } from "./matching-types"

export type TcgDexLookupClient = {
  getCardBySetAndLocalId(language: TcgDexLanguage, setId: string, localId: string): Promise<TcgDexCard>
  getCardById(language: TcgDexLanguage, cardId: string): Promise<TcgDexCard>
}

type NumberParts = { numerator: string; denominator?: string }

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.normalize("NFC").trim()
  return result || undefined
}

function numberParts(value: string): NumberParts | undefined {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(value)
  return match ? { numerator: match[1].replace(/^0+(?=\d)/, ""), ...(match[2] ? { denominator: match[2].replace(/^0+(?=\d)/, "") } : {}) } : undefined
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
}

function validLocalCardNumber(value: unknown): value is string {
  if (typeof value !== "string") return false
  const cleaned = clean(value)
  if (!cleaned || hasControlCharacter(cleaned)) return false
  if (!cleaned.includes("/")) return true
  const parts = cleaned.split("/")
  return parts.length === 2 && parts.every((part) => part.length > 0)
}

function validProviderIdentifier(value: unknown): value is string {
  const cleaned = clean(value)
  return Boolean(cleaned && !hasControlCharacter(cleaned) && !cleaned.includes("/"))
}

export function matchesLocalIdentity(localCardNumber: string, providerLocalId: string): boolean {
  const a = clean(localCardNumber); const b = clean(providerLocalId)
  if (!a || !b) return false
  if (a === b) return true
  const pa = numberParts(a); const pb = numberParts(b)
  if (!pa || !pb) return false
  if (pa.denominator) {
    if (pb.denominator) return pa.numerator === pb.numerator && pa.denominator === pb.denominator
    return pa.numerator === pb.numerator
  }
  return !pb.denominator && pa.numerator === pb.numerator
}

type SetResolution = { status: "VALID"; id: string } | { status: "MISSING" } | { status: "INVALID" }

function trustedSetId(input: TcgDexMatchInput): SetResolution {
  const direct = clean(input.setIdentity?.tcgdexSetId)
  const externalReference = input.setIdentity?.externalReference
  if (externalReference && externalReference.provider !== "TCGDEX") return { status: "INVALID" }
  const reference = clean(externalReference?.providerIdentifier)
  const directWasSupplied = input.setIdentity?.tcgdexSetId !== undefined
  const referenceWasSupplied = externalReference !== undefined
  if ((directWasSupplied && (!direct || !validProviderIdentifier(direct))) ||
    (referenceWasSupplied && (!reference || !validProviderIdentifier(reference)))) return { status: "INVALID" }
  if (!direct && !reference) return { status: "MISSING" }
  if (direct && reference && direct !== reference) return { status: "INVALID" }
  return { status: "VALID", id: direct ?? reference! }
}

function validInput(input: TcgDexMatchInput): boolean {
  return Object.prototype.hasOwnProperty.call(TCGDEX_LANGUAGE, input.language) &&
    validProviderIdentifier(input.setCode) && validLocalCardNumber(input.cardNumber)
}

function providerFailure(error: TcgDexError, source: "AUTOMATIC" | "MANUAL"): TcgDexMatchResult {
  return { code: TCGDEX_MATCH_CODE.PROVIDER_ERROR, source, providerCode: error.code, attemptCount: error.attemptCount }
}

function identityResult(input: TcgDexMatchInput, card: TcgDexCard, source: "AUTOMATIC" | "MANUAL"): TcgDexMatchResult {
  const setResolution = trustedSetId(input)
  const expectedSetId = setResolution.status === "VALID" ? setResolution.id : undefined
  const actual = { setId: card.set.id, localId: card.localId }
  if (!matchesLocalIdentity(input.cardNumber, card.localId) || (expectedSetId && expectedSetId !== card.set.id)) {
    return { code: TCGDEX_MATCH_CODE.IDENTITY_MISMATCH, source, expected: { setId: expectedSetId, localId: input.cardNumber }, actual }
  }
  return { code: TCGDEX_MATCH_CODE.MATCHED, source, enrichment: normalizeTcgdexCard(card) }
}

export async function matchTcgdexCard(input: TcgDexMatchInput, client: TcgDexLookupClient): Promise<TcgDexMatchResult> {
  const source = input.manualCardReference ? TCGDEX_MATCH_SOURCE.MANUAL : TCGDEX_MATCH_SOURCE.AUTOMATIC
  if (!validInput(input)) {
    const field = !Object.prototype.hasOwnProperty.call(TCGDEX_LANGUAGE, input.language) || !clean(input.language)
      ? "language"
      : !validProviderIdentifier(input.setCode) ? "setCode" : "cardNumber"
    return { code: TCGDEX_MATCH_CODE.INVALID_LOCAL_IDENTITY, source, field }
  }
  const manualId = clean(input.manualCardReference?.providerIdentifier)
  if (input.manualCardReference && (!manualId || !validProviderIdentifier(manualId) || input.manualCardReference.provider !== "TCGDEX")) return { code: TCGDEX_MATCH_CODE.INVALID_LOCAL_IDENTITY, source, field: "reference" }
  const setResolution = trustedSetId(input)
  if (setResolution.status === "INVALID") return { code: TCGDEX_MATCH_CODE.INVALID_LOCAL_IDENTITY, source, field: "reference" }
  if (!manualId && setResolution.status === "MISSING") return { code: TCGDEX_MATCH_CODE.UNRESOLVED_SET, source: TCGDEX_MATCH_SOURCE.AUTOMATIC, setCode: input.setCode }
  const resolvedSetId = setResolution.status === "VALID" ? setResolution.id : undefined

  let card: TcgDexCard
  try {
    card = manualId ? await client.getCardById(input.language as TcgDexLanguage, manualId) : await client.getCardBySetAndLocalId(input.language as TcgDexLanguage, resolvedSetId!, input.cardNumber.trim())
  } catch (error) {
    if (!(error instanceof TcgDexError)) throw error
    if (error.code === TCGDEX_ERROR_CODE.NOT_FOUND) return { code: TCGDEX_MATCH_CODE.NO_MATCH, source, reason: "NOT_FOUND" }
    const providerCodes = [TCGDEX_ERROR_CODE.RATE_LIMITED, TCGDEX_ERROR_CODE.SERVER_ERROR, TCGDEX_ERROR_CODE.TIMEOUT, TCGDEX_ERROR_CODE.NETWORK_ERROR, TCGDEX_ERROR_CODE.INVALID_RESPONSE] as const
    if (providerCodes.includes(error.code as (typeof providerCodes)[number])) return providerFailure(error, source)
    throw error
  }
  if (manualId && card.id !== manualId) return { code: TCGDEX_MATCH_CODE.IDENTITY_MISMATCH, source, expected: { setId: resolvedSetId, localId: input.cardNumber }, actual: { setId: card.set.id, localId: card.localId } }
  return identityResult(input, card, source)
}
