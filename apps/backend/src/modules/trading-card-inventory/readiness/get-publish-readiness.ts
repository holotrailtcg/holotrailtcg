import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import type TradingCardsModuleService from "../../trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import type TradingCardInventoryModuleService from "../service"
import { INVENTORY_HOLDING_STATUS, INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_SOURCE_STATUS } from "../types"

export const PUBLISH_READINESS_BLOCKER = {
  NO_LINKED_PRODUCT: "NO_LINKED_PRODUCT",
  NO_LINKED_PRODUCT_VARIANT: "NO_LINKED_PRODUCT_VARIANT",
  NO_APPROVED_TCGDEX_DATA: "NO_APPROVED_TCGDEX_DATA",
  NO_READY_IMAGE: "NO_READY_IMAGE",
  ZERO_APPROVED_QUANTITY: "ZERO_APPROVED_QUANTITY",
  INVALID_OR_MISSING_SELLING_PRICE: "INVALID_OR_MISSING_SELLING_PRICE",
  UNRESOLVED_PENDING_PROPOSAL: "UNRESOLVED_PENDING_PROPOSAL",
} as const
export type PublishReadinessBlocker = (typeof PUBLISH_READINESS_BLOCKER)[keyof typeof PUBLISH_READINESS_BLOCKER]

export interface PublishReadinessResult {
  tradingCardVariantId: string
  ready: boolean
  blockers: PublishReadinessBlocker[]
}

/**
 * Always computed live from Stage 3 (canonical/rarity), Stage 4A
 * (TCGdex-applied rarity, same field), Stage 4B (READY card images), and
 * this module's own holding/proposal state — never a persisted flag, so it
 * cannot drift out of sync with the state it describes. Callers with a
 * `MedusaContainer` (Admin routes, tests) resolve everything needed
 * themselves; this stays a plain function rather than a module service
 * method because it composes two other modules' services plus `query.graph`,
 * none of which a module service constructor can reach.
 */
export async function getPublishReadiness(
  container: MedusaContainer,
  tradingCardVariantId: string
): Promise<PublishReadinessResult> {
  const blockers: PublishReadinessBlocker[] = []

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)

  const variant = await cards.retrieveTradingCardVariant(tradingCardVariantId, { relations: ["trading_card"] })

  if (!variant.trading_card.rarity || !variant.trading_card.rarity_icon_key) {
    blockers.push(PUBLISH_READINESS_BLOCKER.NO_APPROVED_TCGDEX_DATA)
  }

  const readyImages = await cards.listCardImages({ trading_card_variant_id: tradingCardVariantId, status: "READY" })
  if (readyImages.length === 0) blockers.push(PUBLISH_READINESS_BLOCKER.NO_READY_IMAGE)

  const { data: linkedVariants } = await query.graph({
    entity: "trading_card_variant",
    fields: ["id", "product_variant.id", "product_variant.product.id"],
    filters: { id: tradingCardVariantId },
  })
  const productVariant = linkedVariants[0]?.product_variant as { id?: string; product?: { id?: string } } | null
  if (!productVariant?.product?.id) {
    blockers.push(PUBLISH_READINESS_BLOCKER.NO_LINKED_PRODUCT)
  } else if (!productVariant?.id) {
    blockers.push(PUBLISH_READINESS_BLOCKER.NO_LINKED_PRODUCT_VARIANT)
  }

  const holdings = await inventory.listInventoryHoldings(
    { trading_card_variant_id: tradingCardVariantId, status: INVENTORY_HOLDING_STATUS.READY },
    { relations: ["inventory_source"] }
  )
  const activeReadyHoldings = holdings.filter(
    (holding) => (holding.inventory_source as { status?: string })?.status === INVENTORY_SOURCE_STATUS.ACTIVE
  )
  const approvedQuantity = activeReadyHoldings.reduce((sum, holding) => sum + (holding.quantity ?? 0), 0)
  if (approvedQuantity <= 0) {
    blockers.push(PUBLISH_READINESS_BLOCKER.ZERO_APPROVED_QUANTITY)
  } else {
    const hasInvalidPrice = activeReadyHoldings.some((holding) => {
      if ((holding.quantity ?? 0) <= 0) return false
      const price = holding.unit_selling_price
      return price === null || price === undefined || Number(price) <= 0
    })
    if (hasInvalidPrice) blockers.push(PUBLISH_READINESS_BLOCKER.INVALID_OR_MISSING_SELLING_PRICE)
  }

  const pendingProposals = await inventory.listInventoryProposals({
    trading_card_variant_id: tradingCardVariantId, review_status: INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING,
  })
  if (pendingProposals.length > 0) blockers.push(PUBLISH_READINESS_BLOCKER.UNRESOLVED_PENDING_PROPOSAL)

  return { tradingCardVariantId, ready: blockers.length === 0, blockers }
}
