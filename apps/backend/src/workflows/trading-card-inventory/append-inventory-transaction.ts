import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { AppendInventoryTransactionInput } from "../../modules/trading-card-inventory/service"

export async function appendInventoryTransactionWithVariantCheck(
  container: MedusaContainer, input: AppendInventoryTransactionInput
) {
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  await cards.retrieveTradingCardVariant(input.tradingCardVariantId)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  return inventory.appendInventoryTransaction(input)
}

const appendInventoryTransactionStep = createStep(
  "append-inventory-transaction",
  async (input: AppendInventoryTransactionInput, { container }) => {
    const transaction = await appendInventoryTransactionWithVariantCheck(container, input)
    return new StepResponse(transaction)
  }
)

export const appendInventoryTransactionWorkflow = createWorkflow(
  "append-inventory-transaction",
  (input: AppendInventoryTransactionInput) => {
    const transaction = appendInventoryTransactionStep(input)
    return new WorkflowResponse(transaction)
  }
)
