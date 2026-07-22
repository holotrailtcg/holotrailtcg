import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  ebayIntegrationService, fillFromAcceptedTcgdexProposal, loadConfirmedEbayCategory, loadTcgdexSnapshotExtras,
  tradingCardInventoryService, tradingCardsService,
} from "../../shared"

interface LinkedVariantRecord extends Record<string, unknown> {
  id: string
  trading_card_variant?: Record<string, unknown> | null
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "trading_card.*",
      "trading_card.card_set.*",
      "variants.id",
      "variants.trading_card_variant.*",
    ],
    filters: { id: req.params.id },
  })

  const product = data[0]
  if (!product?.trading_card) {
    res.status(200).json({ trading_card: null })
    return
  }

  const inventoryService = tradingCardInventoryService(req)
  const ebayService = ebayIntegrationService(req)
  const linkedVariants = (product.variants ?? []).filter((variant: Record<string, unknown>) => variant.trading_card_variant) as LinkedVariantRecord[]
  const variants = await Promise.all(linkedVariants.map(async (variant) => {
    const tradingCardVariant = variant.trading_card_variant as Record<string, unknown>
    const ebayCategory = typeof tradingCardVariant.id === "string"
      ? await loadConfirmedEbayCategory(inventoryService, ebayService, tradingCardVariant.id)
      : null
    return { medusa_product_variant_id: variant.id, ...tradingCardVariant, ebay_category: ebayCategory }
  }))

  const filledCardFields = await fillFromAcceptedTcgdexProposal(
    tradingCardsService(req),
    product.trading_card as Record<string, unknown>,
  )
  const tcgdexExtras = await loadTcgdexSnapshotExtras(tradingCardsService(req), (product.trading_card as { id: string }).id)

  res.status(200).json({
    trading_card: {
      ...filledCardFields,
      medusa_product_id: product.id,
      variants,
      tcgdex_extras: tcgdexExtras,
    },
  })
}
