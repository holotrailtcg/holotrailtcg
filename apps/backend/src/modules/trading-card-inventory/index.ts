import { Module } from "@medusajs/framework/utils"
import TradingCardInventoryModuleService from "./service"

export const TRADING_CARD_INVENTORY_MODULE = "tradingCardInventory"

export default Module(TRADING_CARD_INVENTORY_MODULE, { service: TradingCardInventoryModuleService })
