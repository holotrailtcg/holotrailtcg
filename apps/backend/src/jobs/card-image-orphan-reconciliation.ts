import type { MedusaContainer } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"
import {
  CARD_IMAGE_ORPHAN_GRACE_PERIOD_MINUTES, CARD_IMAGE_ORPHAN_MAX_OBJECTS_PER_RUN,
} from "../modules/trading-cards/types"
import { resolveCardImageCleanupDryRun } from "../modules/trading-cards/images/cleanup-config"
import { resolveR2Config } from "../modules/trading-cards/images/r2-config"
import { createR2ImageStorageClient, type R2ImageStorageClient } from "../modules/trading-cards/images/r2-client"
import { MANAGED_FINAL_PREFIX, MANAGED_STAGING_PREFIX } from "../modules/trading-cards/images/managed-prefixes"
import type { OrphanReconciliationCounts } from "../modules/trading-cards/images/orphan-reconciliation"

interface ReconcileOrphanedImageObjectsStore {
  reconcileOrphanedImageObjects(input: {
    r2Client: R2ImageStorageClient
    prefix: string
    graceCutoff: Date
    dryRun: boolean
    maxObjectsPerRun: number
    databaseUrl: string
  }): Promise<OrphanReconciliationCounts>
}

function logCounts(prefixLabel: string, dryRun: boolean, counts: OrphanReconciliationCounts): void {
  console.log(
    `[card-image-orphan-reconciliation] ${prefixLabel}: scanned=${counts.scanned} ` +
    `retained=${counts.retained} wouldDelete=${counts.wouldDelete} deleted=${counts.deleted} ` +
    `errors=${counts.errors} pagesProcessed=${counts.pagesProcessed} limitReached=${counts.limitReached} ` +
    `dryRun=${dryRun}`
  )
}

/**
 * Daily scheduled job (see `config.schedule` below) that deletes R2 objects
 * under the two managed prefixes that are older than the grace period and
 * unreferenced by any live `CardImage` row. Dry-run by default
 * (`CARD_IMAGE_CLEANUP_DRY_RUN`, `images/cleanup-config.ts`) — only counts
 * candidates until explicitly set to the exact string `"false"`. A no-op
 * everywhere R2 is not configured. Staging and final prefixes run
 * sequentially in independent `try/catch` blocks so a failure on one never
 * stops the other. Only aggregate counts are ever logged — never an object
 * key, image id, variant id, URL, or credential.
 */
export default async function cardImageOrphanReconciliationJob(container: MedusaContainer) {
  const r2Config = resolveR2Config()
  if (!r2Config.enabled) {
    console.log("[card-image-orphan-reconciliation] R2 is not configured; skipping")
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.log("[card-image-orphan-reconciliation] DATABASE_URL is not configured; skipping")
    return
  }

  const service = container.resolve<ReconcileOrphanedImageObjectsStore>(TRADING_CARDS_MODULE)
  const r2Client = createR2ImageStorageClient(r2Config)
  const dryRun = resolveCardImageCleanupDryRun()
  const graceCutoff = new Date(Date.now() - CARD_IMAGE_ORPHAN_GRACE_PERIOD_MINUTES * 60_000)

  const prefixes: Array<{ label: string; prefix: string }> = [
    { label: "staging", prefix: MANAGED_STAGING_PREFIX },
    { label: "final", prefix: MANAGED_FINAL_PREFIX },
  ]

  for (const { label, prefix } of prefixes) {
    try {
      const counts = await service.reconcileOrphanedImageObjects({
        r2Client, prefix, graceCutoff, dryRun,
        maxObjectsPerRun: CARD_IMAGE_ORPHAN_MAX_OBJECTS_PER_RUN,
        databaseUrl,
      })
      logCounts(label, dryRun, counts)
    } catch {
      // Never surface a raw error (which could echo a key or connection
      // detail) — a safe aggregate failure line is all this logs. The other
      // prefix still runs regardless of this one's outcome.
      console.log(`[card-image-orphan-reconciliation] ${label}: run failed`)
    }
  }
}

export const config = {
  name: "card-image-orphan-reconciliation",
  schedule: "0 3 * * *", // daily at 03:00
}
