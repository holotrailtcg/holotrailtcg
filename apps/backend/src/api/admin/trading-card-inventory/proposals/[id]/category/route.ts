import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { EBAY_INTEGRATION_MODULE } from "../../../../../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../../../../../modules/ebay-integration/service"
import { EBAY_ENVIRONMENT } from "../../../../../../modules/ebay-integration/types"
import {
  adminActor, idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite,
  toSafeInventoryProposalDto, tradingCardInventoryService,
} from "../../../shared"

const bodySchema = z
  .object({
    environment: z.enum([EBAY_ENVIRONMENT.SANDBOX, EBAY_ENVIRONMENT.PRODUCTION]),
    storeCategoryId: z.string().trim().min(1).max(128),
  })
  .strict()

/**
 * Confirms (accepts the computed proposal, or overrides it with a manual
 * choice) the eBay Store category for one inventory proposal. This is the
 * only path that can populate `confirmed_ebay_store_category_id` — a
 * displayed proposal alone is never treated as confirmation, and an
 * in-scope proposal cannot be applied without going through this endpoint
 * first (see `applyInventoryProposal`'s NEW_HOLDING gate).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(bodySchema, req.body ?? {})
  const ebayIntegration = req.scope.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)

  const isActive = await safeAdminRead(() => ebayIntegration.isActiveStoreCategory(body.environment, body.storeCategoryId))
  if (!isActive) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The selected eBay Store category is not active. Choose another category.")
  }

  const saved = await safeAdminWrite(() =>
    tradingCardInventoryService(req).confirmProposalCategory({ proposalId: id, storeCategoryId: body.storeCategoryId, actor: adminActor(req) }),
  )
  res.status(200).json({ proposal: toSafeInventoryProposalDto(saved) })
}
