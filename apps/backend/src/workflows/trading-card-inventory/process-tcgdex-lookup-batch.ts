import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { resolveTcgDexAdminClient } from "../../api/admin/tcgdex/dependencies"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import { parseProductId } from "../../modules/trading-card-inventory/pulse/product-id"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TCGDEX_ERROR_CODE, TcgDexError } from "../../modules/trading-cards/tcgdex/errors"
import { matchTcgdexCard, matchesLocalIdentity } from "../../modules/trading-cards/tcgdex"
import { CARD_GAME, EXTERNAL_PROVIDER, type CardLanguage } from "../../modules/trading-cards/types"

const AMBIGUOUS_CANDIDATE_LIMIT = 5

export interface ProcessTcgdexLookupBatchInput {
  snapshotId: string
  /** How many not-yet-looked-up cards to call TCGdex for in this one call — the client repeats this call until `remaining` is 0. */
  batchSize: number
}

export interface ProcessTcgdexLookupBatchResult {
  /** Distinct unmatched cards in this snapshot whose set is mapped, so a lookup is actually possible. */
  totalCandidates: number
  /** Distinct unmatched cards whose set has no confirmed mapping yet — see the Sync step's set-mapping banner. */
  needsSetMappingCount: number
  cachedCount: number
  processedThisBatch: number
  remaining: number
}

export interface ResolvedSnapshotTcgdexCandidates {
  language: CardLanguage | null
  /** Distinct (tcgdexSetId, cardNumber) identities from this snapshot's still-unmatched rows whose set is mapped. */
  uniqueCandidates: Array<{ tcgdexSetId: string; cardNumber: string }>
  /** How many distinct unmatched cards reference a set with no confirmed mapping yet. */
  needsSetMappingCount: number
  /** Resolved provider-set-code → TCGdex-set-id lookups, reusable by callers that need to re-derive a candidate key per row (e.g. counting affected rows per candidate). */
  tcgdexSetIdBySetCode: Map<string, string>
}

/**
 * Read-only: resolves a snapshot's still-unmatched rows down to the distinct
 * TCGdex card identities a lookup is actually possible for (set already
 * mapped). Shared by the batch-processing step below and by the read-only
 * "list candidates for review" route, so both use the exact same
 * parse-then-map logic.
 */
export async function resolveSnapshotTcgdexCandidates(
  inventory: TradingCardInventoryModuleService, cards: TradingCardsModuleService, snapshotId: string,
): Promise<ResolvedSnapshotTcgdexCandidates> {
  const summary = await inventory.getSnapshotImportSummary(snapshotId)
  const language = (summary.inventorySourceLanguage as CardLanguage | null) ?? null
  if (!language) return { language: null, uniqueCandidates: [], needsSetMappingCount: 0, tcgdexSetIdBySetCode: new Map() }

  const providerReferences = await inventory.listDistinctUnmatchedProviderReferences(snapshotId)
  const parsed = providerReferences
    .map((reference) => parseProductId(reference))
    .filter((row): row is typeof row & { setCodeCandidate: string; cardNumberCandidate: string } =>
      Boolean(row.setCodeCandidate && row.cardNumberCandidate))

  const setCodes = [...new Set(parsed.map((row) => row.setCodeCandidate))]
  const tcgdexSetIdBySetCode = new Map<string, string>()
  for (const setCode of setCodes) {
    const mapping = await cards.findProviderSetMapping({
      provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON, language, providerSetCode: setCode,
    })
    if (mapping) tcgdexSetIdBySetCode.set(setCode, mapping.tcgdex_set_id as string)
  }

  const mappedRows = parsed.filter((row) => tcgdexSetIdBySetCode.has(row.setCodeCandidate))
  const candidateKeys = mappedRows.map((row) => ({
    tcgdexSetId: tcgdexSetIdBySetCode.get(row.setCodeCandidate) as string,
    // TCGdex local ids never carry Pulse's own "/denominator" suffix.
    cardNumber: row.cardNumberCandidate.split("/")[0].trim(),
  }))
  const uniqueCandidates = [...new Map(candidateKeys.map((key) => [`${key.tcgdexSetId}::${key.cardNumber}`, key])).values()]

  return { language, uniqueCandidates, needsSetMappingCount: parsed.length - mappedRows.length, tcgdexSetIdBySetCode }
}

export async function processTcgdexLookupBatch(
  container: MedusaContainer, input: ProcessTcgdexLookupBatchInput,
): Promise<ProcessTcgdexLookupBatchResult> {
    const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

    const { language, uniqueCandidates, needsSetMappingCount } = await resolveSnapshotTcgdexCandidates(inventory, cards, input.snapshotId)
    const empty: ProcessTcgdexLookupBatchResult = { totalCandidates: 0, needsSetMappingCount: 0, cachedCount: 0, processedThisBatch: 0, remaining: 0 }
    if (!language) return empty

    const existing = await cards.listTcgdexLookupCandidates({ provider: EXTERNAL_PROVIDER.PULSE, language, keys: uniqueCandidates })
    const existingKeySet = new Set(existing.map((row) => `${row.tcgdex_set_id}::${row.card_number}`))
    const notYetLookedUp = uniqueCandidates.filter((candidate) => !existingKeySet.has(`${candidate.tcgdexSetId}::${candidate.cardNumber}`))

    const client = resolveTcgDexAdminClient(container)
    const batch = notYetLookedUp.slice(0, input.batchSize)
    let processedThisBatch = 0
    for (const candidate of batch) {
      const result = await matchTcgdexCard(
        { language, setCode: candidate.tcgdexSetId, cardNumber: candidate.cardNumber, setIdentity: { tcgdexSetId: candidate.tcgdexSetId } },
        client,
      )
      // A transient provider failure must be retried on the next batch call,
      // never remembered as if it were a stable result. `INVALID_LOCAL_IDENTITY`
      // should not be reachable here (candidates are pre-filtered to have a
      // parseable set code and card number) — if it ever does happen, skip
      // rather than force it into an outcome the cache schema doesn't model.
      if (result.code === "PROVIDER_ERROR" || result.code === "INVALID_LOCAL_IDENTITY") continue

      // The exact (set, local number) lookup found nothing — before caching a
      // dead-end `NO_MATCH`, try a set-scoped fallback: does this set contain
      // any card whose local id loosely matches (denominator/leading-zero
      // tolerant, via the same `matchesLocalIdentity` the exact path uses)?
      // If so, this is genuinely ambiguous (never auto-applied — see the
      // model's docblock) rather than a dead end. A *stable* failure here
      // (the set genuinely doesn't exist on TCGdex) falls back to the plain
      // `NO_MATCH` the exact lookup already established. A *transient*
      // failure (timeout, rate limit, server/network error) must not be
      // allowed to silently become that same `NO_MATCH` — it must skip this
      // candidate entirely so the next batch call retries it, the same rule
      // that already applies to the exact lookup above.
      if (result.code === "NO_MATCH") {
        let candidateOptions: Array<{ tcgdexCardId: string; localId: string; name: string; image: string | null }> = []
        try {
          const setDetail = await client.getSetById(language, candidate.tcgdexSetId)
          candidateOptions = (setDetail.cards ?? [])
            .filter((setCard) => matchesLocalIdentity(candidate.cardNumber, setCard.localId))
            .slice(0, AMBIGUOUS_CANDIDATE_LIMIT)
            .map((setCard) => ({ tcgdexCardId: setCard.id, localId: setCard.localId, name: setCard.name, image: setCard.image ?? null }))
        } catch (error) {
          if (!(error instanceof TcgDexError) || error.code !== TCGDEX_ERROR_CODE.NOT_FOUND) continue
          candidateOptions = []
        }
        if (candidateOptions.length > 0) {
          await cards.recordTcgdexLookupCandidate({
            provider: EXTERNAL_PROVIDER.PULSE, language, tcgdexSetId: candidate.tcgdexSetId, cardNumber: candidate.cardNumber,
            matchOutcome: "AMBIGUOUS", candidateOptions,
          })
          processedThisBatch += 1
          continue
        }
      }

      await cards.recordTcgdexLookupCandidate({
        provider: EXTERNAL_PROVIDER.PULSE, language, tcgdexSetId: candidate.tcgdexSetId, cardNumber: candidate.cardNumber,
        matchOutcome: result.code, enrichment: result.code === "MATCHED" ? (result.enrichment as unknown as Record<string, unknown>) : null,
      })
      processedThisBatch += 1
    }

    return {
      totalCandidates: uniqueCandidates.length,
      needsSetMappingCount,
      cachedCount: existingKeySet.size,
      processedThisBatch,
      remaining: notYetLookedUp.length - processedThisBatch,
    }
}

const processTcgdexLookupBatchStep = createStep(
  "process-tcgdex-lookup-batch",
  async (input: ProcessTcgdexLookupBatchInput, { container }): Promise<StepResponse<ProcessTcgdexLookupBatchResult>> =>
    new StepResponse(await processTcgdexLookupBatch(container, input)),
)

export const processTcgdexLookupBatchWorkflow = createWorkflow(
  "process-tcgdex-lookup-batch",
  (input: ProcessTcgdexLookupBatchInput) => new WorkflowResponse(processTcgdexLookupBatchStep(input)),
)
