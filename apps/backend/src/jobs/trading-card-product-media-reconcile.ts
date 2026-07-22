import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"
import type TradingCardsModuleService from "../modules/trading-cards/service"
import { syncTradingCardProductMedia } from "../workflows/trading-cards/sync-product-media"

/**
 * Bounded per-page batch size — mirrors the pattern used by
 * card-image-expiry-sweep so one tick can never issue an unbounded query.
 */
const RECONCILE_BATCH_SIZE = 200

interface TradingCardProductRow {
  id: string
  thumbnail: string | null
  trading_card: { id: string } | null
}

/**
 * syncTradingCardProductMedia only ever runs as a best-effort side effect of
 * a single request (image confirm, proposal apply) and any failure there is
 * only console.error'd, never retried. If R2 was misconfigured — or the
 * request crashed — at that exact moment, the product is left without media
 * forever, with no signal that anything is wrong. This job is the retry: it
 * periodically finds trading-card products with no thumbnail and re-runs the
 * same idempotent sync, so a transient failure self-heals within one tick
 * instead of requiring someone to notice and run the manual backfill script.
 */
export default async function tradingCardProductMediaReconcileJob(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

  let offset = 0
  let synced = 0
  let skipped = 0
  let failed = 0

  while (true) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "thumbnail", "trading_card.id"],
      filters: { thumbnail: null },
      pagination: { skip: offset, take: RECONCILE_BATCH_SIZE },
    })
    const rows = data as unknown as TradingCardProductRow[]

    for (const product of rows) {
      const tradingCardId = product.trading_card?.id
      if (!tradingCardId) continue

      const [variant] = await cards.listTradingCardVariants(
        { trading_card_id: tradingCardId },
        { order: { created_at: "ASC" }, take: 1 },
      )
      if (!variant) continue

      try {
        const result = await syncTradingCardProductMedia(container, variant.id)
        if (result.outcome === "SYNCED" && result.imageCount > 0) {
          synced += 1
        } else {
          skipped += 1
        }
      } catch (error) {
        failed += 1
        console.error(
          `[trading-card-product-media-reconcile] failed to sync product ${product.id}`,
          error,
        )
      }
    }

    if (rows.length < RECONCILE_BATCH_SIZE) break
    offset += RECONCILE_BATCH_SIZE
  }

  console.log(
    `[trading-card-product-media-reconcile] synced=${synced} skipped=${skipped} failed=${failed}`,
  )
}

export const config = {
  name: "trading-card-product-media-reconcile",
  schedule: "*/15 * * * *", // every 15 minutes
}
