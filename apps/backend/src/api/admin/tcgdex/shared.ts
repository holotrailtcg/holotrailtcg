import type { MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { z } from "@medusajs/framework/zod"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import type TradingCardsModuleService from "../../../modules/trading-cards/service"

export function tradingCardsService(req: MedusaRequest): TradingCardsModuleService {
  return req.scope.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
}

export function parseAdminInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The request parameters are invalid.")
  }
  return result.data
}

export async function safeAdminRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof MedusaError) throw error
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The TCGdex review data could not be loaded."
    )
  }
}
