import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import type { Rarity, RarityIconKey, RecordOrigin } from "../../modules/trading-cards/types"
import { cardNumberForms } from "../../modules/trading-cards/identity/card-number"
import { rarityComparisonForm } from "../../modules/trading-cards/rarity/normalise-rarity"

export interface CreateTradingCardForProductInput {
  productId: string
  card: {
    card_set_id: string
    name: string
    search_name: string
    slug?: string | null
    card_number: string
    rarity_raw?: string | null
    rarity?: Rarity | null
    rarity_icon_key?: RarityIconKey | null
    origin?: RecordOrigin
  }
}

const createTradingCardStep = createStep(
  "create-trading-card",
  async (input: CreateTradingCardForProductInput, { container }) => {
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    await products.retrieveProduct(input.productId)
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const number = cardNumberForms(input.card.card_number)
    const card = await cards.createTradingCards({
      ...input.card,
      card_number: number.original,
      card_number_normalised: number.normalised,
      rarity_raw: input.card.rarity_raw ?? null,
      rarity_comparison: input.card.rarity_raw == null
        ? null
        : rarityComparisonForm(input.card.rarity_raw),
    })
    return new StepResponse(card, card.id)
  },
  async (cardId, { container }) => {
    if (!cardId) return
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    await cards.deleteTradingCards(cardId)
  }
)

export const createTradingCardForProductWorkflow = createWorkflow(
  "create-trading-card-for-product",
  (input: CreateTradingCardForProductInput) => {
    const card = createTradingCardStep(input)
    const links = transform({ input, card }, ({ input, card }) => [{
      [Modules.PRODUCT]: { product_id: input.productId },
      [TRADING_CARDS_MODULE]: { trading_card_id: card.id },
    }])
    createRemoteLinkStep(links)
    return new WorkflowResponse(card)
  }
)
