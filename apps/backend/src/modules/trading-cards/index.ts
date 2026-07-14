import { Module } from "@medusajs/framework/utils"
import TradingCardsModuleService from "./service"

export const TRADING_CARDS_MODULE = "tradingCards"

export default Module(TRADING_CARDS_MODULE, { service: TradingCardsModuleService })
