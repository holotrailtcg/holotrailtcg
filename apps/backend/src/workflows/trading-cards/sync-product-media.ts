import type { IProductModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { resolveR2Config } from "../../modules/trading-cards/images/r2-config"

export interface SyncTradingCardProductMediaResult {
  outcome: "SYNCED" | "SKIPPED"
  productId: string | null
  imageCount: number
  reason?: "IMAGES_DISABLED" | "NO_PRODUCT_LINK"
}

/**
 * Mirrors every READY photograph for the card owning `tradingCardVariantId`
 * into its linked Medusa Product. Product media is card-wide, so photographs
 * from all of the card's variants are included in deterministic variant/image
 * order. TCGDex reference artwork is deliberately excluded.
 */
export async function syncTradingCardProductMedia(
  container: MedusaContainer,
  tradingCardVariantId: string,
): Promise<SyncTradingCardProductMediaResult> {
  const r2Config = resolveR2Config()
  if (!r2Config.enabled) {
    return { outcome: "SKIPPED", productId: null, imageCount: 0, reason: "IMAGES_DISABLED" }
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "trading_card_variant",
    fields: ["id", "trading_card.id", "trading_card.product.id"],
    filters: { id: tradingCardVariantId },
  })
  const tradingCard = data[0]?.trading_card as { id?: string; product?: { id?: string } | null } | null
  const productId = tradingCard?.product?.id ?? null
  if (!tradingCard?.id || !productId) {
    return { outcome: "SKIPPED", productId, imageCount: 0, reason: "NO_PRODUCT_LINK" }
  }

  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const variants = await cards.listTradingCardVariants(
    { trading_card_id: tradingCard.id },
    { order: { created_at: "ASC" } },
  )
  const imageUrls: string[] = []
  for (const variant of variants) {
    const images = await cards.listCardImagesForVariant({ tradingCardVariantId: variant.id })
    for (const image of images) {
      if (image.status !== "READY" || typeof image.final_object_key !== "string") continue
      imageUrls.push(await cards.deriveCardImagePublicUrl({
        publicBaseUrl: r2Config.publicBaseUrl,
        objectKey: image.final_object_key,
      }))
    }
  }

  const uniqueUrls = [...new Set(imageUrls)]
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  await products.updateProducts(productId, {
    thumbnail: uniqueUrls[0] ?? null,
    images: uniqueUrls.map((url) => ({ url })),
  })

  return { outcome: "SYNCED", productId, imageCount: uniqueUrls.length }
}
