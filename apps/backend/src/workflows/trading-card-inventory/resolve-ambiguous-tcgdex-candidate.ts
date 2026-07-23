import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { resolveTcgDexAdminClient } from "../../api/admin/tcgdex/dependencies"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"

export interface ResolveAmbiguousTcgdexCandidateInput {
  actor: string
  candidateId: string
  chosenTcgdexCardId: string
  reason?: string | null
}

/**
 * A reviewer's explicit pick from an `AMBIGUOUS` lookup candidate's
 * shortlist — see `resolveAmbiguousTcgdexLookupCandidate`'s docblock for why
 * this never re-validates card-number identity the way the automatic exact
 * lookup does.
 */
const resolveAmbiguousTcgdexCandidateStep = createStep(
  "resolve-ambiguous-tcgdex-candidate",
  async (input: ResolveAmbiguousTcgdexCandidateInput, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const client = resolveTcgDexAdminClient(container)
    const saved = await cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: input.actor, source: "MANUAL", reason: input.reason ?? null,
      candidateId: input.candidateId, chosenTcgdexCardId: input.chosenTcgdexCardId, client,
    })
    return new StepResponse(saved)
  },
)

export const resolveAmbiguousTcgdexCandidateWorkflow = createWorkflow(
  "resolve-ambiguous-tcgdex-candidate",
  (input: ResolveAmbiguousTcgdexCandidateInput) => new WorkflowResponse(resolveAmbiguousTcgdexCandidateStep(input)),
)
