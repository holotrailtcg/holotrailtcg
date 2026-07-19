import type { ExecArgs } from "@medusajs/framework/types"
import type { IProductModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { syncTradingCardProductMedia } from "../workflows/trading-cards/sync-product-media"

export default async function syncTradingCardProductMediaScript({ container }: ExecArgs) {
  const variantId = process.env.TRADING_CARD_PRODUCT_MEDIA_VARIANT_ID?.trim()
  if (!variantId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "TRADING_CARD_PRODUCT_MEDIA_VARIANT_ID is required")
  }

  const result = await syncTradingCardProductMedia(container, variantId)
  const product = result.productId
    ? await container.resolve<IProductModuleService>(Modules.PRODUCT).retrieveProduct(
        result.productId,
        { relations: ["images"] },
      )
    : null
  console.log(JSON.stringify({
    tradingCardVariantId: variantId,
    ...result,
    verifiedThumbnail: product?.thumbnail ?? null,
    verifiedImageUrls: product?.images?.map((image) => image.url) ?? [],
  }))
}
