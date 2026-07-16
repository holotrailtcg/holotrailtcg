import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { UpsertInventoryHoldingInput } from "../../modules/trading-card-inventory/service"

/**
 * This module stores `trading_card_variant_id` as a plain text column with
 * no Postgres FK (it belongs to a different module's table) — existence is
 * confirmed here via a cross-module service call before the holding
 * transaction starts, mirroring how Stage 3 validates the product hierarchy
 * before creating a trading-card variant link. Exported as a plain function
 * (rather than inlined in the step) so it can be unit tested with a fake
 * container without needing the full workflow engine.
 */
export async function upsertInventoryHoldingWithVariantCheck(
  container: MedusaContainer, input: UpsertInventoryHoldingInput
) {
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  await cards.retrieveTradingCardVariant(input.tradingCardVariantId)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  return inventory.upsertInventoryHolding(input)
}

const upsertInventoryHoldingStep = createStep(
  "upsert-inventory-holding",
  async (input: UpsertInventoryHoldingInput, { container }) => {
    const holding = await upsertInventoryHoldingWithVariantCheck(container, input)
    return new StepResponse(holding)
  }
)

export const upsertInventoryHoldingWorkflow = createWorkflow(
  "upsert-inventory-holding",
  (input: UpsertInventoryHoldingInput) => {
    const holding = upsertInventoryHoldingStep(input)
    return new WorkflowResponse(holding)
  }
)
