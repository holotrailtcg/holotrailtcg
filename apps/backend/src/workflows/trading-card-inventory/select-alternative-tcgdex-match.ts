import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { INVENTORY_AUDIT_ACTION } from "../../modules/trading-card-inventory/types"

export interface SelectAlternativeTcgdexMatchInput {
  actor: string
  snapshotEntryId: string
  tcgdexSetId: string
  tcgdexCardId: string
  reason?: string | null
}

export type SelectAlternativeTcgdexMatchResult =
  | { outcome: "REMATCHED"; tradingCardId: string; tradingCardVariantId: string; imageReassignmentWarning: boolean }
  | { outcome: "NO_EXISTING_CARD_OR_VARIANT" }

/**
 * Stage 1: lets a reviewer point an already-parsed snapshot row at a
 * *different* TCGdex card than whatever it currently resolves to (wrong
 * automatic match, or a manual correction). Preserves the row's own
 * explicit condition/finish/special-treatment/language/quantity — the
 * reviewer only ever picks the canonical card identity, never those
 * per-row attributes, so the saleable identity stays exactly what the CSV
 * said. Only resolves to an EXISTING `TradingCardVariant` (found via a
 * confirmed TCGdex external reference at the row's own condition/finish/
 * treatment); if none exists yet, returns `NO_EXISTING_CARD_OR_VARIANT`
 * rather than creating one here — that creation path is the manual
 * local-correction workflow, which already implements the safe
 * create-or-reuse chain. Never moves images (out of scope for Stage 1) —
 * `imageReassignmentWarning` is set instead when the entry's current
 * variant already has photographs, so the Admin UI can warn the reviewer.
 */
const selectAlternativeTcgdexMatchStep = createStep(
  "select-alternative-tcgdex-match",
  async (input: SelectAlternativeTcgdexMatchInput, { container }): Promise<StepResponse<SelectAlternativeTcgdexMatchResult>> => {
    const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

    // Read-only pre-check: fast-fails obviously-invalid requests (missing
    // row, already-applied match) before spending a DB write or a TCGdex
    // identity lookup. This is advisory only — `selectAlternativeMatchForEntry`
    // below re-validates the applied-status fresh, under a row lock, so a
    // concurrent request can never race past a stale read of this check.
    const entry = await inventory.retrieveSnapshotEntryForRematch(input.snapshotEntryId)
    if (!entry) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Snapshot entry not found")
    if (entry.current_variant_applied) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This row's current match has already been applied to stock and cannot be rematched",
      )
    }

    const condition = entry.condition_candidate as string | null
    const finish = entry.finish_candidate as string | null
    const specialTreatment = entry.special_treatment_candidate as string | null
    if (!condition || !finish || !specialTreatment) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "This row has no resolved condition/finish/special-treatment to rematch against")
    }

    const found = await cards.findExistingVariantForTcgdexCard({
      tcgdexCardId: input.tcgdexCardId, condition, finish, specialTreatment,
    })
    if (!found) return new StepResponse({ outcome: "NO_EXISTING_CARD_OR_VARIANT" })

    const previousVariantIdBeforeWrite = (entry.effective_trading_card_variant_id as string | null) ?? null
    const previousTcgdexCardId = previousVariantIdBeforeWrite
      ? await cards.findTrustedTcgdexIdentifierForVariant(previousVariantIdBeforeWrite)
      : null

    const priceLockedVariantIds = (await cards.listTradingCardVariants({ id: [found.tradingCardVariantId] }))
      .filter((variant: Record<string, unknown>) => variant.price_locked)
      .map((variant: Record<string, unknown>) => variant.id as string)

    // The one atomic write: locks the entry row, re-validates the
    // applied-status check fresh (never trusting the pre-check above), and
    // records the new match — see `selectAlternativeMatchForEntry` for why
    // this must be a single transaction rather than a separate read+write.
    const { previousVariantId } = await inventory.selectAlternativeMatchForEntry({
      actor: input.actor, source: "MANUAL", reason: input.reason ?? null,
      snapshotEntryId: input.snapshotEntryId, tradingCardVariantId: found.tradingCardVariantId,
      priceLockedVariantIds,
    })

    // Stage 1 must not move images itself — warn whenever there was a
    // previous match (the only case where photographs could already exist
    // against the old variant) rather than reaching into the image module
    // just to render an exact count.
    const imageReassignmentWarning = Boolean(previousVariantId)

    // Confirmed, reviewer-selected identity — safe to persist as trusted, mirroring the existing manual-reference convention.
    await cards.recordTrustedTcgdexCardReference({
      actor: input.actor, source: "MANUAL", reason: input.reason ?? null,
      tradingCardId: found.tradingCardId, providerIdentifier: input.tcgdexCardId,
    }).catch(() => undefined)

    await inventory.recordImportLifecycleAudit({
      actor: input.actor, source: "MANUAL", reason: input.reason ?? null,
      snapshotId: entry.inventory_snapshot_id as string,
      action: INVENTORY_AUDIT_ACTION.ENTRY_MATCH_REMATCHED,
      newValue: {
        snapshotEntryId: input.snapshotEntryId,
        previousVariantId, previousTcgdexCardId,
        newTcgdexSetId: input.tcgdexSetId, newTcgdexCardId: input.tcgdexCardId, newTradingCardVariantId: found.tradingCardVariantId,
      },
    })

    return new StepResponse({
      outcome: "REMATCHED", tradingCardId: found.tradingCardId, tradingCardVariantId: found.tradingCardVariantId,
      imageReassignmentWarning,
    })
  },
)

export const selectAlternativeTcgdexMatchWorkflow = createWorkflow(
  "select-alternative-tcgdex-match",
  (input: SelectAlternativeTcgdexMatchInput) => new WorkflowResponse(selectAlternativeTcgdexMatchStep(input)),
)
