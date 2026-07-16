import { assertManagedPrefix } from "./managed-prefixes"
import type { R2ImageStorageClient } from "./r2-client"

/**
 * Stage 4B.4 Slice 2: the pure list/check/delete loop for one managed
 * prefix, decoupled from locking and from how "referenced" is determined —
 * `TradingCardsModuleService.reconcileOrphanedImageObjects` supplies the
 * real `isReferenced` callback (a `trading_card_image` lookup); tests supply
 * a fake one. Kept independent of `this.manager_`/the module service so it
 * can be unit-tested directly against `FakeR2ImageStorageClient`.
 */

export interface OrphanReconciliationCounts {
  scanned: number
  retained: number
  wouldDelete: number
  deleted: number
  errors: number
  pagesProcessed: number
  limitReached: boolean
}

export interface RunOrphanReconciliationInput {
  r2Client: R2ImageStorageClient
  prefix: string
  graceCutoff: Date
  dryRun: boolean
  maxObjectsPerRun: number
  /** Page size for each `listObjects` call; defaults to 1000 (S3/R2's own per-call maximum). */
  pageSize?: number
  /** Must check both `staging_object_key` and `final_object_key` on live rows. */
  isReferenced: (key: string) => Promise<boolean>
}

const DEFAULT_PAGE_SIZE = 1000

function emptyCounts(): OrphanReconciliationCounts {
  return { scanned: 0, retained: 0, wouldDelete: 0, deleted: 0, errors: 0, pagesProcessed: 0, limitReached: false }
}

export async function runOrphanReconciliation(
  input: RunOrphanReconciliationInput
): Promise<OrphanReconciliationCounts> {
  assertManagedPrefix(input.prefix)
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
  const counts = emptyCounts()
  let inspected = 0
  let continuationToken: string | undefined

  while (true) {
    const page = await input.r2Client.listObjects({
      prefix: input.prefix, continuationToken, maxKeys: pageSize,
    })
    counts.pagesProcessed += 1

    // Tracks whether the cap was hit with objects still unprocessed in this
    // page — that alone proves more backlog remains, independent of
    // whether the listing itself reports a continuation token.
    let capHitMidPage = false

    for (const object of page.objects) {
      if (inspected >= input.maxObjectsPerRun) {
        capHitMidPage = true
        break
      }
      inspected += 1

      if (object.lastModified > input.graceCutoff) {
        counts.retained += 1
        continue
      }

      counts.scanned += 1

      const referencedAtScan = await input.isReferenced(object.key)
      if (referencedAtScan) {
        counts.retained += 1
        continue
      }

      // Race-safety: an upload beginning between the scan above and now may
      // have claimed this exact key, so it must be rechecked immediately
      // before any deletion decision — never collapsed into a single check.
      const referencedBeforeDelete = await input.isReferenced(object.key)
      if (referencedBeforeDelete) {
        counts.retained += 1
        continue
      }

      if (input.dryRun) {
        counts.wouldDelete += 1
        continue
      }

      try {
        // Idempotent per `R2ImageStorageClient.deleteObject`: an
        // already-missing key is a silent success, so any thrown error here
        // is a genuine storage failure, correctly counted separately.
        await input.r2Client.deleteObject(object.key)
        counts.deleted += 1
      } catch {
        counts.errors += 1
      }
    }

    continuationToken = page.nextContinuationToken

    if (capHitMidPage) {
      counts.limitReached = true
      break
    }

    if (inspected >= input.maxObjectsPerRun) {
      // Every object in this page was consumed and the cap landed exactly
      // on a page boundary. Whether real backlog remains depends only on
      // what the listing itself reports — a `nextContinuationToken` means
      // more objects exist beyond this run's cap; its absence means this
      // page was also the last page, so there is nothing left to report.
      counts.limitReached = Boolean(continuationToken)
      break
    }

    if (!continuationToken) {
      break
    }
  }

  return counts
}
