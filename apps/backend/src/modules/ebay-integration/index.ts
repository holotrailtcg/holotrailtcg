import { Module } from "@medusajs/framework/utils"
import EbayIntegrationModuleService from "./service"

export const EBAY_INTEGRATION_MODULE = "ebayIntegration"

export default Module(EBAY_INTEGRATION_MODULE, { service: EbayIntegrationModuleService })
