import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { CreateInventoryProposalInput } from "../../modules/trading-card-inventory/service"

/** Validates `tradingCardVariantId` when present — a proposal may legitimately have no resolved variant yet ("unresolved card variant"). */
export async function createInventoryProposalWithVariantCheck(
  container: MedusaContainer, input: CreateInventoryProposalInput
) {
  if (input.tradingCardVariantId) {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    await cards.retrieveTradingCardVariant(input.tradingCardVariantId)
  }
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  return inventory.createInventoryProposal(input)
}

const createInventoryProposalStep = createStep(
  "create-inventory-proposal",
  async (input: CreateInventoryProposalInput, { container }) => {
    const proposal = await createInventoryProposalWithVariantCheck(container, input)
    return new StepResponse(proposal)
  }
)

export const createInventoryProposalWorkflow = createWorkflow(
  "create-inventory-proposal",
  (input: CreateInventoryProposalInput) => {
    const proposal = createInventoryProposalStep(input)
    return new WorkflowResponse(proposal)
  }
)
