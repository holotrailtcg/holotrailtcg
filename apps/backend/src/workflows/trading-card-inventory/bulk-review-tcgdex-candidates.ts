import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { CatalogueIntegrityError, createCardFromInventoryRowWorkflow } from "../trading-cards/create-card-from-inventory-row"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import { parseProductId } from "../../modules/trading-card-inventory/pulse/product-id"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import type { CardEnrichmentData } from "../../modules/trading-cards/tcgdex/matching-types"
import { CARD_GAME, EXTERNAL_PROVIDER, type CardLanguage } from "../../modules/trading-cards/types"
import { retryPulseSnapshotMatching } from "./pulse-import-shared"

export interface BulkReviewTcgdexCandidatesInput {
  actor: string
  snapshotId: string
  candidateIds: string[]
  action: "ACCEPT" | "REJECT"
}

export interface CandidateReviewResult {
  candidateId: string
  createdVariantCount: number
  /** Rows tied to this candidate whose finish/special treatment/condition couldn't be resolved — left for manual "Create card", same as today. */
  skippedRowCount: number
  errors: string[]
}

export interface BulkReviewTcgdexCandidatesResult {
  results: CandidateReviewResult[]
}

const bulkReviewTcgdexCandidatesStep = createStep(
  "bulk-review-tcgdex-candidates",
  async (input: BulkReviewTcgdexCandidatesInput, { container }): Promise<StepResponse<BulkReviewTcgdexCandidatesResult>> => {
    const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

    if (input.action === "REJECT") {
      await cards.reviewTcgdexLookupCandidates({ ids: input.candidateIds, reviewStatus: "REJECTED" })
      return new StepResponse({
        results: input.candidateIds.map((candidateId) => ({ candidateId, createdVariantCount: 0, skippedRowCount: 0, errors: [] })),
      })
    }

    const summary = await inventory.getSnapshotImportSummary(input.snapshotId)
    const language = (summary.inventorySourceLanguage as CardLanguage | null) ?? null
    if (!language) {
      return new StepResponse({
        results: input.candidateIds.map((candidateId) => ({ candidateId, createdVariantCount: 0, skippedRowCount: 0, errors: ["This inventory source has no configured language."] })),
      })
    }

    const unmatchedEntries = await inventory.listUnmatchedSnapshotEntriesForAdmin(input.snapshotId)

    const results: CandidateReviewResult[] = []
    for (const candidateId of input.candidateIds) {
      const candidate = await cards.retrieveTcgdexLookupCandidateById(candidateId)
      if (!candidate || candidate.match_outcome !== "MATCHED" || candidate.review_status !== "PENDING") {
        results.push({ candidateId, createdVariantCount: 0, skippedRowCount: 0, errors: ["This match is no longer pending review."] })
        continue
      }
      const enrichment = candidate.enrichment as CardEnrichmentData | null
      if (!enrichment) {
        results.push({ candidateId, createdVariantCount: 0, skippedRowCount: 0, errors: ["This match has no card data recorded."] })
        continue
      }

      let createdVariantCount = 0
      let skippedRowCount = 0
      const errors: string[] = []

      const matchingEntries = unmatchedEntries.filter((entry) => {
        const reference = entry.provider_reference as string
        const parsed = parseProductId(reference)
        if (!parsed.setCodeCandidate || !parsed.cardNumberCandidate) return false
        return parsed.cardNumberCandidate.split("/")[0].trim() === candidate.card_number
      })
      // Duplicate CSV rows share one canonical provider reference and one
      // unresolved proposal. Create that variant once; the matching retry at
      // the end resolves every source row carrying the same reference.
      const uniqueMatchingEntries = [...new Map(
        matchingEntries.map((entry) => [entry.provider_reference as string, entry]),
      ).values()]

      for (const entry of uniqueMatchingEntries) {
        const reference = entry.provider_reference as string
        const parsed = parseProductId(reference)
        const setCode = parsed.setCodeCandidate as string
        const mapping = await cards.findProviderSetMapping({
          provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON, language, providerSetCode: setCode,
        })
        if (!mapping || mapping.tcgdex_set_id !== candidate.tcgdex_set_id) continue

        const finish = entry.finish_candidate as string | null
        const specialTreatment = entry.special_treatment_candidate as string | null
        const condition = entry.condition_candidate as string | null
        if (!finish || !specialTreatment || !condition) {
          skippedRowCount += 1
          continue
        }

        const [proposalRows] = await inventory.listAndCountInventoryProposals(
          { inventory_snapshot_id: input.snapshotId, provider_reference: reference, change_kind: "UNRESOLVED_VARIANT" },
          { take: 1 },
        )
        const proposal = proposalRows[0]
        if (!proposal) {
          skippedRowCount += 1
          continue
        }

        const claim = await inventory.beginCardCreationClaim({ actor: input.actor, source: "MANUAL", proposalId: proposal.id as string })
        if (!claim.claimToken) {
          if (!claim.alreadyResolved) errors.push(`${reference}: already being created by another request`)
          continue
        }

        try {
          const { result: createdCard } = await createCardFromInventoryRowWorkflow(container).run({
            input: {
              actor: input.actor, source: "MANUAL", proposalId: proposal.id as string, claimToken: claim.claimToken,
              cardSetProviderSetCode: setCode, cardSetDisplayName: mapping.tcgdex_set_name as string,
              cardGame: CARD_GAME.POKEMON, cardLanguage: language,
              name: enrichment.name, cardNumber: parsed.cardNumberCandidate as string,
              rarityRaw: enrichment.providerRarity ?? (entry.rarity_raw as string | null) ?? null,
              condition: condition as never, finish: finish as never, specialTreatment: specialTreatment as never,
              finishConfirmed: true, specialTreatmentConfirmed: true,
            },
          })
          // The lookup candidate is the exact TCGdex snapshot the admin
          // approved. Attach that same snapshot to the newly resolved card
          // so its reference artwork and provider rarity remain available
          // after the inventory row changes from awaiting review to matched.
          // `recordTcgdexMatchResult` is fingerprint-idempotent, so this is
          // also safe when the create workflow's best-effort live lookup
          // already recorded the same snapshot.
          await cards.recordTcgdexMatchResult({
            actor: input.actor,
            source: "TCGDEX",
            tradingCardId: createdCard.tradingCardId,
            result: { code: "MATCHED", source: "AUTOMATIC", enrichment },
          })
          createdVariantCount += 1
        } catch (error) {
          if (CatalogueIntegrityError.isCatalogueIntegrityError(error)) errors.push(`${reference}: ${(error as Error).message}`)
          else errors.push(`${reference}: could not be created`)
        }
      }

      // A failed create must remain retryable. Previously every candidate
      // was marked ACCEPTED even when all of its variants failed, which hid
      // it from the table and made the approval error impossible to retry.
      if (errors.length === 0) {
        await cards.reviewTcgdexLookupCandidates({ ids: [candidateId], reviewStatus: "ACCEPTED" })
      }
      results.push({ candidateId, createdVariantCount, skippedRowCount, errors })
    }

    // A newly-created card only resolves the one duplicate-reference row its
    // proposal was built from (see `resolveInventoryProposalVariant`) — any
    // sibling rows sharing the same provider reference (a duplicate CSV
    // line, e.g. two physical copies of the same card) are still UNMATCHED
    // until matching runs again. Re-running it here, once, for every row
    // this batch touched removes the need for a separate manual "Retry
    // matching" click. Never fatal: the cards themselves are already
    // created even if this re-check fails.
    if (results.some((result) => result.createdVariantCount > 0)) {
      try {
        await retryPulseSnapshotMatching(container, { actor: input.actor, source: "MANUAL", snapshotId: input.snapshotId })
      } catch { /* best-effort — see comment above */ }
    }

    return new StepResponse({ results })
  },
)

export const bulkReviewTcgdexCandidatesWorkflow = createWorkflow(
  "bulk-review-tcgdex-candidates",
  (input: BulkReviewTcgdexCandidatesInput) => new WorkflowResponse(bulkReviewTcgdexCandidatesStep(input)),
)
