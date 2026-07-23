import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchJson, postAction } from "./fetch-json"

interface FailedCandidate {
  id: string
  matchOutcome: "NO_MATCH" | "UNRESOLVED_SET" | "IDENTITY_MISMATCH"
  tcgdexSetId: string
  cardNumber: string
  rowCount: number
}

const OUTCOME_LABEL: Record<string, string> = {
  NO_MATCH: "No match found",
  UNRESOLVED_SET: "Set not recognised",
  IDENTITY_MISMATCH: "TCGdex returned a different card",
}

interface FailedLookupsPanelProps {
  snapshotId: string
  onRetried: () => void
}

/**
 * Stage 1: a failed (NO_MATCH/UNRESOLVED_SET/IDENTITY_MISMATCH) TCGdex
 * lookup is cached forever by the automatic batch process — it is never
 * retried on its own. This is the manual Retry action the Stage 1 spec
 * requires, showing each failed identity's last outcome and how many rows
 * it affects.
 */
const FailedLookupsPanel = ({ snapshotId, onRetried }: FailedLookupsPanelProps) => {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["tcgdex-failed-lookups", snapshotId],
    queryFn: () => fetchJson<{ failed: FailedCandidate[] }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/failed`,
    ),
    enabled: Boolean(snapshotId),
  })

  const retryMutation = useMutation({
    mutationFn: (candidate: FailedCandidate) => postAction<{ result: { code: string; providerCode: string | null } }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/retry`,
      { tcgdexSetId: candidate.tcgdexSetId, cardNumber: candidate.cardNumber },
    ),
    onSuccess: ({ result }) => {
      if (result.code === "MATCHED") {
        toast.success("TCGdex found a match this time.")
      } else if (result.code === "PROVIDER_ERROR" || result.code === "INVALID_LOCAL_IDENTITY") {
        // `providerCode` distinguishes a genuine timeout from other transient
        // provider failures (rate limiting, network error, server error) so
        // the reviewer isn't shown one generic message for all of them.
        const message = result.providerCode === "TIMEOUT"
          ? "TCGdex timed out retrying this lookup — its previous result was kept. Try again shortly."
          : "TCGdex could not be reached to retry this lookup — its previous result was kept. Try again shortly."
        toast.error(message)
      } else {
        toast.info("TCGdex was checked again — still no match.")
      }
      client.invalidateQueries({ queryKey: ["tcgdex-failed-lookups", snapshotId] })
      onRetried()
    },
    onError: (error: Error) => toast.error(error.message || "TCGdex could not be reached. Please try again."),
  })

  const failed = query.data?.failed ?? []
  if (!query.isLoading && failed.length === 0) return null

  return (
    <Container className="flex flex-col gap-3 p-6">
      <Heading level="h2">Failed TCGdex lookups</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        These identities didn't match anything on TCGdex the last time they were checked. Retry
        after fixing a set mapping, or if you think this was a temporary issue.
      </Text>
      {query.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
      <ul className="flex flex-col gap-2">
        {failed.map((candidate) => (
          <li key={candidate.id} className="flex items-center gap-3 border-b py-2 text-sm">
            <Badge size="2xsmall" color="red">{OUTCOME_LABEL[candidate.matchOutcome] ?? candidate.matchOutcome}</Badge>
            <span className="flex-1">
              {candidate.tcgdexSetId} #{candidate.cardNumber} · affects {candidate.rowCount} row{candidate.rowCount === 1 ? "" : "s"}
            </span>
            <Button size="small" variant="secondary" isLoading={retryMutation.isPending} onClick={() => retryMutation.mutate(candidate)}>
              Retry
            </Button>
          </li>
        ))}
      </ul>
    </Container>
  )
}

export default FailedLookupsPanel
