import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  ebayIntegrationService, fillFromAcceptedTcgdexProposal, loadConfirmedEbayCategory, loadTcgdexSnapshotExtras,
  tradingCardInventoryService, tradingCardsService,
} from "../../shared"

/**
 * Resolves the trading card owning `inventory_item_id`, following the
 * reverse of the chain `get-inventory-overview.ts` uses: inventory_item
 * -> variants (product_variant) -> trading_card_variant -> trading_card.
 * Powers the
 * "Trading card" widget on Medusa's built-in Inventory Item detail page,
 * mirroring `by-product/[id]/route.ts` for the Product detail page.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "variants.id",
      "variants.trading_card_variant.*",
      "variants.trading_card_variant.trading_card.*",
      "variants.trading_card_variant.trading_card.card_set.*",
      "variants.trading_card_variant.trading_card.product.id",
    ],
    filters: { id: req.params.id },
  })

  const item = data[0] as {
    variants?: Array<{
      id?: string
      trading_card_variant?: (Record<string, unknown> & {
        trading_card?: (Record<string, unknown> & {
          card_set?: Record<string, unknown> | null
          product?: { id?: string } | null
        }) | null
      }) | null
    }> | null
  } | undefined

  const productVariant = (item?.variants ?? []).find((variant) => variant.trading_card_variant)
  const tradingCardVariant = productVariant?.trading_card_variant
  const tradingCard = tradingCardVariant?.trading_card
  if (!tradingCardVariant || !tradingCard) {
    res.status(200).json({ trading_card: null })
    return
  }

  const { trading_card: _omit, ...variantFields } = tradingCardVariant
  const { product, ...cardFields } = tradingCard
  const filledCardFields = await fillFromAcceptedTcgdexProposal(tradingCardsService(req), cardFields)
  const tcgdexExtras = typeof cardFields.id === "string"
    ? await loadTcgdexSnapshotExtras(tradingCardsService(req), cardFields.id)
    : null
  const ebayCategory = typeof tradingCardVariant.id === "string"
    ? await loadConfirmedEbayCategory(tradingCardInventoryService(req), ebayIntegrationService(req), tradingCardVariant.id as string)
    : null

  res.status(200).json({
    trading_card: {
      ...filledCardFields,
      medusa_product_id: product?.id ?? null,
      tcgdex_extras: tcgdexExtras,
      variant: {
        medusa_product_variant_id: productVariant?.id ?? null,
        ...variantFields,
        ebay_category: ebayCategory,
      },
    },
  })
}
