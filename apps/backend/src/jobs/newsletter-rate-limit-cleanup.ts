import type { MedusaContainer } from "@medusajs/framework/types"
import { NEWSLETTER_MODULE } from "../modules/newsletter"
import { resolveRateLimitConfig } from "../modules/newsletter/rate-limit/config"
import { computeRateLimitCleanupCutoff } from "../modules/newsletter/rate-limit/cleanup"

/**
 * Buckets are retained for 3 completed windows before becoming eligible
 * for cleanup — comfortably past any conceivable request delay or clock
 * skew, while still bounding table growth. With `RETENTION_WINDOWS >= 1`
 * the cutoff always falls strictly before the active window's
 * `windowStart`, so the active bucket is never touched (see
 * `computeRateLimitCleanupCutoff` and docs/decisions/0005).
 */
const RETENTION_WINDOWS = 3

interface RateLimitCleanupStore {
  cleanupExpiredRateLimitBuckets(cutoff: Date): Promise<number>
}

/**
 * Hourly scheduled job (see `config.schedule` below) that deletes expired
 * newsletter rate-limit buckets. Only an aggregate deleted-row count is
 * logged — never a request key, bucket id, or anything address-derived.
 */
export default async function newsletterRateLimitCleanupJob(container: MedusaContainer) {
  const service = container.resolve<RateLimitCleanupStore>(NEWSLETTER_MODULE)
  const config = resolveRateLimitConfig()
  const cutoff = computeRateLimitCleanupCutoff(new Date(), config.windowSeconds, RETENTION_WINDOWS)

  const deletedCount = await service.cleanupExpiredRateLimitBuckets(cutoff)

  console.log(
    `[newsletter-rate-limit-cleanup] deleted ${deletedCount} expired rate-limit bucket row(s)`
  )
}

export const config = {
  name: "newsletter-rate-limit-cleanup",
  schedule: "0 * * * *", // every hour, on the hour
}
