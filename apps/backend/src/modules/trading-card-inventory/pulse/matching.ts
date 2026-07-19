import type { ParsedPulseRow, RowDiagnostic } from "./types"

export interface TrustedReferenceLookupResult {
  tradingCardId: string
  tradingCardVariantId: string | null
}

export interface CandidateVariant {
  id: string
  tradingCardId: string
}

/**
 * The database-touching side of matching, injected so `matchSnapshotEntry`
 * stays a pure, unit-testable function — mirrors the `TcgDexLookupDependency`
 * pattern used by Stage 4A's matcher. The workflow layer supplies the real
 * implementation backed by the trading-cards module service.
 */
export interface TradingCardMatchLookup {
  /** An existing trusted `ExternalCardReference(provider=PULSE, provider_identifier=productId)`, if any. */
  findTrustedPulseReference(productId: string): Promise<TrustedReferenceLookupResult | null>
  /** Candidate variants for a card identified by (setCodeCandidate, cardNumberCandidate, language) matching the given exact commercial attributes. */
  findCandidateVariants(input: {
    setCodeCandidate: string
    cardNumberCandidate: string
    language: string
    condition: string
    finish: string
    specialTreatment: string
  }): Promise<CandidateVariant[]>
}

export interface MatchOutcome {
  matchingStatus: "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "REVIEW_REQUIRED"
  tradingCardVariantId: string | null
  matchedVia: "TRUSTED_REFERENCE" | "UNIQUE_ATTRIBUTE_MATCH" | "NONE"
  /** Only ever true for a uniquely-proven case-3 match — the only case allowed to write a *new* trusted `ExternalCardReference`. */
  shouldPersistTrustedReference: boolean
  diagnostics: RowDiagnostic[]
}

const NO_MATCH: Omit<MatchOutcome, "diagnostics"> = {
  matchingStatus: "UNMATCHED", tradingCardVariantId: null, matchedVia: "NONE", shouldPersistTrustedReference: false,
}

export async function matchSnapshotEntry(row: ParsedPulseRow, lookup: TradingCardMatchLookup): Promise<MatchOutcome> {
  if (row.outcome === "INVALID" || row.outcome === "SKIPPED") {
    return { ...NO_MATCH, diagnostics: [] }
  }

  const trusted = await lookup.findTrustedPulseReference(row.providerReference)
  if (trusted) {
    if (trusted.tradingCardVariantId) {
      return { matchingStatus: "MATCHED", tradingCardVariantId: trusted.tradingCardVariantId, matchedVia: "TRUSTED_REFERENCE", shouldPersistTrustedReference: false, diagnostics: [] }
    }
    // Case 2: trusted reference to the card only — attempt an exact-attribute match scoped to that one card.
    if (row.finishCandidate && row.specialTreatmentCandidate && !row.conditionUnknownToken && row.languageCandidate && !row.languageConflict) {
      const candidates = (await lookup.findCandidateVariants({
        setCodeCandidate: row.setCodeCandidate ?? "", cardNumberCandidate: row.cardNumberCandidate ?? "",
        language: row.languageCandidate, condition: row.conditionCandidate ?? "", finish: row.finishCandidate,
        specialTreatment: row.specialTreatmentCandidate,
      })).filter((candidate) => candidate.tradingCardId === trusted.tradingCardId)
      if (candidates.length === 1) {
        return { matchingStatus: "MATCHED", tradingCardVariantId: candidates[0].id, matchedVia: "TRUSTED_REFERENCE", shouldPersistTrustedReference: false, diagnostics: [] }
      }
      if (candidates.length > 1) {
        return {
          matchingStatus: "AMBIGUOUS", tradingCardVariantId: null, matchedVia: "NONE", shouldPersistTrustedReference: false,
          diagnostics: [{ rowNumber: row.rowNumber, phase: "MATCHING", code: "AMBIGUOUS_VARIANT_MATCH", severity: "WARNING", fieldRef: null, message: "More than one variant matches this card's commercial attributes." }],
        }
      }
    }
    return {
      matchingStatus: "REVIEW_REQUIRED", tradingCardVariantId: null, matchedVia: "NONE", shouldPersistTrustedReference: false,
      diagnostics: [{ rowNumber: row.rowNumber, phase: "MATCHING", code: "CARD_MATCHED_VARIANT_UNRESOLVED", severity: "INFO", fieldRef: null, message: "Card is trusted-matched but no exact commercial-attribute variant could be resolved." }],
    }
  }

  // Case 3: no trusted reference at all — only attempt when every attribute is either explicit or a
  // cleanly-absent condition defaulted to Near Mint (never on a genuinely unrecognized/garbled condition
  // token, nor a guessed finish/treatment/language/identity).
  const canAttemptUniqueMatch =
    row.finishCandidate && row.specialTreatmentCandidate && !row.conditionUnknownToken &&
    row.languageCandidate && !row.languageConflict && row.setCodeCandidate && row.cardNumberCandidate

  if (!canAttemptUniqueMatch) {
    return {
      ...NO_MATCH, matchingStatus: "REVIEW_REQUIRED",
      diagnostics: [{ rowNumber: row.rowNumber, phase: "MATCHING", code: "MATCHING_ATTRIBUTES_INCOMPLETE", severity: "INFO", fieldRef: null, message: "One or more commercial attributes were defaulted or unresolved, so no automatic match was attempted." }],
    }
  }

  const candidates = await lookup.findCandidateVariants({
    setCodeCandidate: row.setCodeCandidate!, cardNumberCandidate: row.cardNumberCandidate!,
    language: row.languageCandidate!, condition: row.conditionCandidate!, finish: row.finishCandidate!,
    specialTreatment: row.specialTreatmentCandidate!,
  })

  if (candidates.length === 1) {
    return { matchingStatus: "MATCHED", tradingCardVariantId: candidates[0].id, matchedVia: "UNIQUE_ATTRIBUTE_MATCH", shouldPersistTrustedReference: true, diagnostics: [] }
  }
  if (candidates.length > 1) {
    return {
      matchingStatus: "AMBIGUOUS", tradingCardVariantId: null, matchedVia: "NONE", shouldPersistTrustedReference: false,
      diagnostics: [{ rowNumber: row.rowNumber, phase: "MATCHING", code: "AMBIGUOUS_VARIANT_MATCH", severity: "WARNING", fieldRef: null, message: "More than one existing variant matches this row's identity and commercial attributes." }],
    }
  }
  return {
    ...NO_MATCH,
    diagnostics: [{ rowNumber: row.rowNumber, phase: "MATCHING", code: "NO_VARIANT_MATCH", severity: "INFO", fieldRef: null, message: "No existing trading-card variant matches this row." }],
  }
}
