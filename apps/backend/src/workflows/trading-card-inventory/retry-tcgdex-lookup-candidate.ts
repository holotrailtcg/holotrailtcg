import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { resolveTcgDexAdminClient } from "../../api/admin/tcgdex/dependencies"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { EXTERNAL_PROVIDER, type CardLanguage } from "../../modules/trading-cards/types"

export interface RetryTcgdexLookupCandidateInput {
  actor: string
  language: CardLanguage
  tcgdexSetId: string
  cardNumber: string
  reason?: string | null
}

export interface RetryTcgdexLookupCandidateResult {
  code: string
  /** Present only for a PROVIDER_ERROR outcome — the specific transient subtype (TIMEOUT, RATE_LIMITED, NETWORK_ERROR, SERVER_ERROR, ...), so the Admin UI can show an accurate message instead of one generic "unreachable" toast. */
  providerCode: string | null
  candidate: Record<string, unknown> | null
  retried: boolean
}

/**
 * Stage 1: manual per-identity retry for a failed (or never-attempted)
 * TCGdex lookup candidate. See `TradingCardsModuleService#retryTcgdexLookupCandidate`
 * for the bypass-the-cache / idempotent-on-success / never-cache-provider-error
 * behaviour — this workflow only wires the live client in, mirroring
 * `process-tcgdex-lookup-batch.ts`'s own client-resolution pattern.
 */
const retryTcgdexLookupCandidateStep = createStep(
  "retry-tcgdex-lookup-candidate",
  async (input: RetryTcgdexLookupCandidateInput, { container }): Promise<StepResponse<RetryTcgdexLookupCandidateResult>> => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const client = resolveTcgDexAdminClient(container)
    const result = await cards.retryTcgdexLookupCandidate({
      actor: input.actor, source: "TCGDEX", reason: input.reason ?? null,
      provider: EXTERNAL_PROVIDER.PULSE, language: input.language, tcgdexSetId: input.tcgdexSetId, cardNumber: input.cardNumber,
      client,
    })
    return new StepResponse(result)
  },
)

export const retryTcgdexLookupCandidateWorkflow = createWorkflow(
  "retry-tcgdex-lookup-candidate",
  (input: RetryTcgdexLookupCandidateInput) => new WorkflowResponse(retryTcgdexLookupCandidateStep(input)),
)
