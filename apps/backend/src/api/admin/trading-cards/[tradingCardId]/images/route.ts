import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  parseAdminInput, safeAdminRead, toSafeCardImageDto, tradingCardIdParamsSchema, tradingCardsService,
} from "../../shared"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { tradingCardId } = parseAdminInput(tradingCardIdParamsSchema, req.params)
  const service = tradingCardsService(req)

  const detail = await safeAdminRead(async () => {
    const card = await service.retrieveCardImageDetail(tradingCardId)
    const variants = await Promise.all(card.variants.map(async (variant) => {
      const rows = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id, includeArchived: true })
      const dtos = await Promise.all(rows.map((row) => toSafeCardImageDto(service, row)))
      return {
        ...variant,
        ready_images: dtos.filter((image) => image.status === "READY"),
        archived_images: dtos.filter((image) => image.status === "ARCHIVED"),
      }
    }))
    return {
      trading_card: card.trading_card,
      card_set: card.card_set,
      tcgdex_reference_artwork_url: card.tcgdex_reference_artwork_url,
      variants,
    }
  })

  res.status(200).json(detail)
}
