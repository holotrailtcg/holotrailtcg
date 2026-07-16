import type { MedusaContainer } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"

/**
 * Bounded per-call batch size — the job loops until a call returns fewer
 * than this many ids, so one hourly tick can still drain a large backlog
 * without ever running a single unbounded update.
 */
const EXPIRY_SWEEP_BATCH_SIZE = 500

interface CardImageExpirySweepStore {
  expirePendingCardImages(cutoff: Date, batchSize: number): Promise<string[]>
}

/**
 * Hourly scheduled job (see `config.schedule` below) that transitions
 * abandoned `PENDING` card-image uploads to `EXPIRED` once their upload
 * window has passed — the same transition `confirmPendingCardImage`
 * already performs lazily, just for uploads nobody ever tried to confirm.
 * Only an aggregate transitioned-row count is logged — never a card-image
 * id, variant id, or object key.
 */
export default async function cardImageExpirySweepJob(container: MedusaContainer) {
  const service = container.resolve<CardImageExpirySweepStore>(TRADING_CARDS_MODULE)
  const cutoff = new Date()

  let totalExpired = 0
  let batch: string[]
  do {
    batch = await service.expirePendingCardImages(cutoff, EXPIRY_SWEEP_BATCH_SIZE)
    totalExpired += batch.length
  } while (batch.length === EXPIRY_SWEEP_BATCH_SIZE)

  console.log(`[card-image-expiry-sweep] expired ${totalExpired} pending card image row(s)`)
}

export const config = {
  name: "card-image-expiry-sweep",
  schedule: "0 * * * *", // every hour, on the hour
}
