/**
 * Retention rule: retain buckets for `retentionWindows` completed windows
 * before they become eligible for cleanup. With `retentionWindows >= 1`
 * the cutoff is always strictly before the current (active) window's
 * `windowStart`, so the active bucket is never deleted — see
 * `docs/decisions/0005-newsletter-backend-design.md` for the full
 * schedule/retention rationale.
 */
export function computeRateLimitCleanupCutoff(
  now: Date,
  windowSeconds: number,
  retentionWindows: number
): Date {
  return new Date(now.getTime() - windowSeconds * retentionWindows * 1000)
}
