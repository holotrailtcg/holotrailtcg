import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { createCardFromInventoryRowWorkflow, CatalogueIntegrityError } from "../../../../workflows/trading-cards/create-card-from-inventory-row"
import { parseProductId } from "../../../../modules/trading-card-inventory/pulse/product-id"
import type { InventoryRecordSource } from "../../../../modules/trading-card-inventory/types"
import { tradingCardInventoryService } from "../../trading-card-inventory/shared"
import {
  adminActor, CARD_GAME, createCardFromInventoryRowBodySchema, parseAdminInput, safeAdminRead, safeAdminWrite,
  tradingCardsService,
} from "../shared"

/**
 * Creates (or reuses) the exact TradingCard/TradingCardVariant identity for
 * an unresolved Pulse import row and resolves the originating proposal to
 * it. Everything identifying *which* row this is comes from the server-side
 * proposal lookup below — the request body only carries reviewer-confirmed
 * display values (see `createCardFromInventoryRowBodySchema`).
 *
 * `beginCardCreationClaim` is called first and is the sole authority on
 * proposal-state eligibility (pending+unresolved → claim; already resolved
 * to a variant → idempotent replay; anything else → rejected) — a separate
 * upfront `review_status`/`change_kind` check here would reject the very
 * idempotent-replay case this route needs to support, since a proposal
 * that has already been resolved is no longer UNRESOLVED_VARIANT.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(createCardFromInventoryRowBodySchema, req.body ?? {})
  const inventory = tradingCardInventoryService(req)
  const cards = tradingCardsService(req)
  const actor = adminActor(req)

  const claim = await safeAdminWrite(() => inventory.beginCardCreationClaim({
    actor, source: "MANUAL", proposalId: body.inventoryProposalId,
  }))

  if (claim.alreadyResolved && claim.tradingCardVariantId) {
    const [variant] = await cards.listTradingCardVariants(
      { id: [claim.tradingCardVariantId] }, { relations: ["trading_card", "trading_card.card_set"] },
    )
    res.status(200).json({ result: toResultDto(claim.tradingCardVariantId, variant as Record<string, unknown> | undefined, "TRIGGERED"), idempotentReplay: true })
    return
  }
  if (!claim.claimToken) {
    res.status(409).json({ message: "This row is already being created by another request. Try again shortly." })
    return
  }

  const proposal = await safeAdminRead(() => inventory.retrieveInventoryProposal(body.inventoryProposalId))
  const snapshot = await safeAdminRead(() => inventory.retrieveInventorySnapshot(proposal.inventory_snapshot_id as string))
  const source = await safeAdminRead(() => inventory.retrieveInventorySource(snapshot.inventory_source_id as string))
  const language = source.language as string | null
  if (!language) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This inventory source has no configured language — set one before creating cards from its rows")
  }

  const providerReference = proposal.provider_reference as string | null
  if (!providerReference) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "This proposal has no provider reference to derive a card identity from")
  }
  const { rows: entries } = await safeAdminRead(() => inventory.listSnapshotEntriesForAdmin(
    proposal.inventory_snapshot_id as string, { providerReference }, { limit: 1, offset: 0 },
  ))
  const entry = entries[0]
  if (!entry) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "No snapshot entry was found for this proposal's provider reference")
  }
  const parsedIdentity = parseProductId(providerReference)
  if (!parsedIdentity.setCodeCandidate || !parsedIdentity.cardNumberCandidate) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "This row's provider reference does not carry a set code and card number")
  }

  try {
    const { result } = await safeAdminWrite(() => createCardFromInventoryRowWorkflow(req.scope).run({
      input: {
        actor, source: "MANUAL" as InventoryRecordSource, proposalId: body.inventoryProposalId, claimToken: claim.claimToken as string,
        cardSetProviderSetCode: parsedIdentity.setCodeCandidate as string, cardSetDisplayName: body.cardSetDisplayName,
        cardGame: CARD_GAME.POKEMON, cardLanguage: language as never,
        name: body.name, cardNumber: body.cardNumber, rarityRaw: body.rarityRaw ?? null,
        condition: body.condition as never, finish: body.finish as never, specialTreatment: body.specialTreatment as never,
        finishConfirmed: body.finishConfirmed, specialTreatmentConfirmed: body.specialTreatmentConfirmed,
      },
    }))
    const [variant] = await cards.listTradingCardVariants(
      { id: [result.tradingCardVariantId] }, { relations: ["trading_card", "trading_card.card_set"] },
    )
    res.status(201).json({ result: toResultDto(result.tradingCardVariantId, variant as Record<string, unknown> | undefined, result.tcgdexEnrichmentStatus), idempotentReplay: false })
  } catch (error) {
    if (CatalogueIntegrityError.isCatalogueIntegrityError(error)) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, error.message)
    }
    throw error
  }
}

function toResultDto(tradingCardVariantId: string, variant: Record<string, unknown> | undefined, tcgdexEnrichmentStatus: string) {
  const tradingCard = variant?.trading_card as Record<string, unknown> | undefined
  const cardSet = tradingCard?.card_set as Record<string, unknown> | undefined
  return {
    tradingCardVariantId,
    tradingCardId: tradingCard?.id ?? null,
    card: tradingCard ? {
      name: tradingCard.name, setDisplayName: cardSet?.display_name ?? null, cardNumber: tradingCard.card_number,
      condition: variant?.condition, finish: variant?.finish, specialTreatment: variant?.special_treatment,
    } : null,
    tcgdexEnrichmentStatus,
  }
}
