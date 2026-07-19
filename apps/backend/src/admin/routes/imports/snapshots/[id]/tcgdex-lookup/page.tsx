import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { postAction } from "../../../../../components/imports/fetch-json"
import ImportStepper from "../../../../../components/imports/import-stepper"
import "../../../../../styles/imports.css"

interface LookupProgress {
  totalCandidates: number
  needsSetMappingCount: number
  cachedCount: number
  processedThisBatch: number
  remaining: number
}

interface ProcessBatchResponse {
  progress: LookupProgress
}

const BATCH_SIZE = 10

/**
 * Client-driven progress loop: repeatedly calls process-batch until nothing
 * is left, then moves on to the Sync step. There is no background job queue
 * in this app, so this open tab — not a server-side job — is what drives
 * the work forward; closing it just pauses progress rather than losing it,
 * since every result is cached as soon as it's found.
 */
const ImportsTcgdexLookupPage = () => {
  const params = useParams<{ id: string }>()
  const snapshotId = params.id ?? ""
  const navigate = useNavigate()
  const [progress, setProgress] = useState<LookupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!snapshotId) return
    let cancelled = false

    const run = async () => {
      for (;;) {
        let response: ProcessBatchResponse
        try {
          response = await postAction<ProcessBatchResponse>(
            `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/process-batch`,
            { batchSize: BATCH_SIZE },
          )
        } catch {
          if (!cancelled) setError("Looking up cards on TCGdex failed. You can continue without it and add matches manually.")
          return
        }
        if (cancelled) return
        setProgress(response.progress)
        if (response.progress.remaining <= 0) break
      }
      if (!cancelled) navigate(`/imports/snapshots/${encodeURIComponent(snapshotId)}`)
    }
    run()

    return () => { cancelled = true }
  }, [snapshotId, navigate])

  const total = progress?.totalCandidates ?? 0
  const done = Math.max(0, total - (progress?.remaining ?? total))
  const percent = total > 0 ? Math.round((done / total) * 100) : 100

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Checking TCGdex</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          Looking up every unmatched row against TCGdex, so you can bulk-confirm matches on the
          next step instead of typing each card in by hand. Rows whose set isn't mapped yet are
          skipped for now — map them via the banner on the next step, then come back to pick up
          where this left off.
        </Text>

        {error ? (
          <>
            <Text size="small" role="alert" className="text-ui-fg-error">{error}</Text>
            <Button onClick={() => navigate(`/imports/snapshots/${encodeURIComponent(snapshotId)}`)}>Continue</Button>
          </>
        ) : (
          <>
            <div
              className="h-2 w-full bg-ui-bg-subtle"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="TCGdex lookup progress"
            >
              <div className="h-2 bg-ui-fg-interactive" style={{ width: `${percent}%` }} />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {progress === null
                ? "Starting — checking how many cards need looking up…"
                : total === 0
                  ? "Nothing to look up — moving on."
                  : `${done} of ${total} cards checked${progress.needsSetMappingCount ? ` (${progress.needsSetMappingCount} skipped — set not mapped yet)` : ""}`}
            </Text>
          </>
        )}
      </Container>
    </div>
  )
}

export default ImportsTcgdexLookupPage
