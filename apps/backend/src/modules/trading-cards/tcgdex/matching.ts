import type { CardLanguage } from "../types"
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

export function equivalentCardNumbers(left: string, right: string): boolean {
  const a = clean(left); const b = clean(right)
  if (!a || !b) return false
  if (a === b) return true
  const pa = numberParts(a); const pb = numberParts(b)
  if (!pa || !pb) return false
  if (pa.denominator && pb.denominator) return pa.numerator === pb.numerator && pa.denominator === pb.denominator
  return pa.numerator === pb.numerator
}

function trustedSetId(input: TcgDexMatchInput): string | undefined {
  const direct = clean(input.setIdentity?.tcgdexSetId)
  const reference = input.setIdentity?.externalReference?.provider === "TCGDEX"
    ? clean(input.setIdentity.externalReference.providerIdentifier)
    : undefined
  return direct ?? reference
}

function validInput(input: TcgDexMatchInput): boolean {
  return Object.prototype.hasOwnProperty.call(TCGDEX_LANGUAGE, input.language) &&
    [input.language, input.setCode, input.cardNumber].every((value) => Boolean(clean(value)))
}

function providerFailure(error: TcgDexError, source: "AUTOMATIC" | "MANUAL"): TcgDexMatchResult {
  return { code: TCGDEX_MATCH_CODE.PROVIDER_ERROR, source, providerCode: error.code, attemptCount: error.attemptCount }
}

function identityResult(input: TcgDexMatchInput, card: TcgDexCard, source: "AUTOMATIC" | "MANUAL"): TcgDexMatchResult {
  const expectedSetId = trustedSetId(input)
  const actual = { setId: card.set.id, localId: card.localId }
  if (!equivalentCardNumbers(input.cardNumber, card.localId) || (expectedSetId && expectedSetId !== card.set.id)) {
    return { code: TCGDEX_MATCH_CODE.IDENTITY_MISMATCH, source, expected: { setId: expectedSetId, localId: input.cardNumber }, actual }
  }
  return { code: TCGDEX_MATCH_CODE.MATCHED, source, card, enrichment: normalizeTcgdexCard(card) }
}

export async function matchTcgdexCard(input: TcgDexMatchInput, client: TcgDexLookupClient): Promise<TcgDexMatchResult> {
  const source = input.manualCardReference ? TCGDEX_MATCH_SOURCE.MANUAL : TCGDEX_MATCH_SOURCE.AUTOMATIC
  if (!validInput(input)) return { code: TCGDEX_MATCH_CODE.INVALID_LOCAL_IDENTITY, source, field: !Object.prototype.hasOwnProperty.call(TCGDEX_LANGUAGE, input.language) || !clean(input.language) ? "language" : !clean(input.setCode) ? "setCode" : "cardNumber" }
  if (input.setIdentity?.externalReference && input.setIdentity.externalReference.provider !== "TCGDEX") return { code: TCGDEX_MATCH_CODE.INVALID_LOCAL_IDENTITY, source, field: "reference" }
  const manualId = clean(input.manualCardReference?.providerIdentifier)
  if (input.manualCardReference && (!manualId || input.manualCardReference.provider !== "TCGDEX")) return { code: TCGDEX_MATCH_CODE.INVALID_LOCAL_IDENTITY, source, field: "reference" }
  const setId = trustedSetId(input)
  if (!manualId && !setId) return { code: TCGDEX_MATCH_CODE.UNRESOLVED_SET, source: TCGDEX_MATCH_SOURCE.AUTOMATIC, setCode: input.setCode }

  let card: TcgDexCard
  try {
    card = manualId ? await client.getCardById(input.language as CardLanguage as TcgDexLanguage, manualId) : await client.getCardBySetAndLocalId(input.language as CardLanguage as TcgDexLanguage, setId!, input.cardNumber.trim())
  } catch (error) {
    if (!(error instanceof TcgDexError)) throw error
    if (error.code === TCGDEX_ERROR_CODE.NOT_FOUND) return { code: TCGDEX_MATCH_CODE.NO_MATCH, source, reason: "NOT_FOUND" }
    const providerCodes = [TCGDEX_ERROR_CODE.RATE_LIMITED, TCGDEX_ERROR_CODE.SERVER_ERROR, TCGDEX_ERROR_CODE.TIMEOUT, TCGDEX_ERROR_CODE.NETWORK_ERROR, TCGDEX_ERROR_CODE.INVALID_RESPONSE] as const
    if (providerCodes.includes(error.code as (typeof providerCodes)[number])) return providerFailure(error, source)
    throw error
  }
  if (manualId && card.id !== manualId) return { code: TCGDEX_MATCH_CODE.IDENTITY_MISMATCH, source, expected: { setId, localId: input.cardNumber }, actual: { setId: card.set.id, localId: card.localId } }
  return identityResult(input, card, source)
}
