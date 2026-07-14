import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { generateSku } from "../../modules/trading-cards/sku/generate-sku"
import type { CardCondition, CardFinish, ConditionSource, RecordOrigin, SpecialTreatment } from "../../modules/trading-cards/types"

export interface CreateVariantForProductVariantInput {
  productVariantId: string
  tradingCardId: string
  condition: CardCondition
  conditionSource: ConditionSource
  finish: CardFinish
  finishConfirmed: boolean
  specialTreatment: SpecialTreatment
  specialTreatmentConfirmed: boolean
  origin?: RecordOrigin
  isHighValueTrackIndividually?: boolean
}

const createTradingCardVariantStep = createStep(
  "create-trading-card-variant",
  async (input: CreateVariantForProductVariantInput, { container }) => {
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const productVariant = await products.retrieveProductVariant(input.productVariantId)
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const card = await cards.retrieveTradingCard(input.tradingCardId, { relations: ["card_set"] })
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: linkedCards } = await query.graph({
      entity: "trading_card",
      fields: ["id", "product.id"],
      filters: { id: card.id },
    })
    await cards.assertVariantProductHierarchy({
      productVariantProductId: productVariant.product_id,
      tradingCardProductId: linkedCards[0]?.product?.id,
    })
    const sku = generateSku({
      tradingCardId: card.id,
      game: card.card_set.game,
      language: card.card_set.language,
      setCode: card.card_set.provider_set_code,
      cardNumber: card.card_number,
      cardName: card.name,
      condition: input.condition,
      finish: input.finish,
      specialTreatment: input.specialTreatment,
    })
    const variant = await cards.createTradingCardVariants({
      trading_card_id: card.id,
      condition: input.condition,
      condition_source: input.conditionSource,
      finish: input.finish,
      finish_confirmed: input.finishConfirmed,
      special_treatment: input.specialTreatment,
      special_treatment_confirmed: input.specialTreatmentConfirmed,
      sku,
      origin: input.origin,
      is_high_value_track_individually: input.isHighValueTrackIndividually ?? false,
    })
    return new StepResponse(variant, variant.id)
  },
  async (variantId, { container }) => {
    if (!variantId) return
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    await cards.deleteTradingCardVariants(variantId)
  }
)

export const createVariantForProductVariantWorkflow = createWorkflow(
  "create-variant-for-product-variant",
  (input: CreateVariantForProductVariantInput) => {
    const variant = createTradingCardVariantStep(input)
    const links = transform({ input, variant }, ({ input, variant }) => [{
      [Modules.PRODUCT]: { product_variant_id: input.productVariantId },
      [TRADING_CARDS_MODULE]: { trading_card_variant_id: variant.id },
    }])
    createRemoteLinkStep(links)
    return new WorkflowResponse(variant)
  }
)
