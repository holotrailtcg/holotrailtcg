import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

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

  const variants = (product.variants ?? [])
    .filter((variant: Record<string, unknown>) => variant.trading_card_variant)
    .map((variant: LinkedVariantRecord) => ({
      medusa_product_variant_id: variant.id,
      ...variant.trading_card_variant,
    }))

  res.status(200).json({
    trading_card: {
      ...product.trading_card,
      medusa_product_id: product.id,
      variants,
    },
  })
}
