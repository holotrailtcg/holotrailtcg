import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchJson, postAction } from "../../../../components/imports/fetch-json"
import ImportStepper from "../../../../components/imports/import-stepper"
import MatchingStatusBadge from "../../../../components/imports/matching-status-badge"
import PaginationBar from "../../../../components/imports/pagination-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../../components/imports/review-table"
import RowOutcomeBadge from "../../../../components/imports/row-outcome-badge"
import type {
  ImportSummary, RetryMatchingResult, SnapshotDiagnosticListItem, SnapshotDiagnosticListResponse,
  SnapshotEntryListItem, SnapshotEntryListResponse, SnapshotProgress,
} from "../../../../components/imports/pulse-import-types"
import "../../../../styles/imports.css"

const ENTRY_PAGE_SIZE = 20
const DIAGNOSTIC_PAGE_SIZE = 20

const OUTSTANDING_MATCHING_STATUSES = ["UNMATCHED", "AMBIGUOUS", "REVIEW_REQUIRED"]

function fetchSummary(snapshotId: string): Promise<{ summary: ImportSummary; progress: SnapshotProgress }> {
  return fetchJson(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`)
}

const ImportsSnapshotDetailPage = () => {
  const params = useParams<{ id: string }>()
  const snapshotId = params.id ?? ""
  const queryClient = useQueryClient()

  const [entryOffset, setEntryOffset] = useState(0)
  const [outcomeFilter, setOutcomeFilter] = useState("")
  const [matchingStatusFilter, setMatchingStatusFilter] = useState("")
  const [entryIdFilter, setEntryIdFilter] = useState("")
  const [diagnosticOffset, setDiagnosticOffset] = useState(0)
  const [severityFilter, setSeverityFilter] = useState("")

  const summaryQuery = useQuery({
    queryKey: ["pulse-import-summary", snapshotId],
    queryFn: () => fetchSummary(snapshotId),
    enabled: Boolean(snapshotId),
  })

  const entriesQuery = useQuery({
    queryKey: ["pulse-import-entries", snapshotId, { entryOffset, outcomeFilter, matchingStatusFilter, entryIdFilter }],
    queryFn: () => {
      const searchParams = new URLSearchParams({ limit: String(ENTRY_PAGE_SIZE), offset: String(entryOffset) })
      if (outcomeFilter) searchParams.set("outcome", outcomeFilter)
      if (matchingStatusFilter) searchParams.set("matchingStatus", matchingStatusFilter)
      if (entryIdFilter) searchParams.set("snapshotEntryId", entryIdFilter)
      return fetchJson<SnapshotEntryListResponse>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/entries?${searchParams.toString()}`,
      )
    },
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
  })

  const diagnosticsQuery = useQuery({
    queryKey: ["pulse-import-diagnostics", snapshotId, { diagnosticOffset, severityFilter }],
    queryFn: () => {
      const searchParams = new URLSearchParams({ limit: String(DIAGNOSTIC_PAGE_SIZE), offset: String(diagnosticOffset) })
      if (severityFilter) searchParams.set("severity", severityFilter)
      return fetchJson<SnapshotDiagnosticListResponse>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/diagnostics?${searchParams.toString()}`,
      )
    },
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
  })

  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["pulse-import-summary", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["pulse-import-entries", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["pulse-import-diagnostics", snapshotId] })
  }

  const retryMutation = useMutation({
    mutationFn: () =>
      postAction<{ result: RetryMatchingResult }>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/retry-matching`,
      ),
    onSuccess: () => {
      toast.success("Matching was run again")
      refreshAfterAction()
    },
    onError: () => toast.error("Matching could not be retried. Please try again."),
  })

  const reconcileMutation = useMutation({
    mutationFn: () =>
      postAction(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/reconcile`),
    onSuccess: () => {
      toast.success("Reconciliation started")
      refreshAfterAction()
    },
    onError: () => toast.error("Reconciliation could not be started. Please try again."),
  })

  const summary = summaryQuery.data?.summary
  const progress = summaryQuery.data?.progress
  const outstandingMatches = summary
    ? OUTSTANDING_MATCHING_STATUSES.reduce((sum, status) => sum + (summary.byMatchingStatus[status] ?? 0), 0)
    : 0
  const canRetryMatching = outstandingMatches > 0 &&
    ["DRAFT", "VALIDATED", "PENDING_REVIEW"].includes(summary?.status ?? "")
  const canReconcile = summary?.status === "VALIDATED"

  const entryColumns: ReviewTableColumn<SnapshotEntryListItem>[] = [
    { header: "Row", cell: (row) => row.rowNumber ?? "—" },
    { header: "Reference", cell: (row) => row.providerReference },
    { header: "Quantity", cell: (row) => row.quantity },
    { header: "Finish", cell: (row) => row.finishCandidate ?? "—" },
    { header: "Treatment", cell: (row) => row.specialTreatmentCandidate ?? "—" },
    { header: "Rarity", cell: (row) => row.rarityCandidate ?? row.rarityRaw ?? "—" },
    { header: "Outcome", cell: (row) => <RowOutcomeBadge outcome={row.outcome} /> },
    { header: "Matched variant", cell: (row) => row.tradingCardVariantId ?? "—" },
    { header: "Review status", cell: (row) => <MatchingStatusBadge status={row.matchingStatus} /> },
  ]

  const diagnosticColumns: ReviewTableColumn<SnapshotDiagnosticListItem>[] = [
    { header: "Row", cell: (row) => (
      <button className="text-ui-fg-interactive" onClick={() => {
        setEntryIdFilter(row.snapshotEntryId)
        setEntryOffset(0)
      }}>{row.rowNumber}</button>
    ) },
    { header: "Severity", cell: (row) => row.severity },
    { header: "Field", cell: (row) => row.fieldRef ?? "—" },
    { header: "Message", cell: (row) => row.message },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Import preview</Heading>
        <ImportStepper compact />
        <Text size="small">
          <Link to="/imports/new">Back to upload</Link>
        </Text>
      </Container>

      {summaryQuery.isLoading && (
        <Container className="p-6">
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        </Container>
      )}
      {summaryQuery.isError && (
        <Container className="p-6">
          <Text size="small" className="text-ui-fg-error">This snapshot could not be loaded.</Text>
        </Container>
      )}

      {summary && (
        <>
          <Container className="flex flex-col gap-3 p-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">File</Text>
                <Text size="small">{summary.originalFilename}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Inventory source</Text>
                <Text size="small">{summary.inventorySourceDisplayName}{summary.inventorySourceLanguage ? ` (${summary.inventorySourceLanguage})` : ""}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Status</Text>
                <Text size="small">{summary.status}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Rows</Text>
                <Text size="small">{summary.rowCount}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Content hash</Text>
                <Text size="small" className="truncate" title={summary.contentHash}>{summary.contentHash.slice(0, 12)}…</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Unique references</Text>
                <Text size="small">{summary.uniqueProviderReferences}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Duplicate rows</Text>
                <Text size="small">{summary.duplicateRowCount}</Text>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              {canRetryMatching && (
                <Button
                  variant="secondary"
                  isLoading={retryMutation.isPending}
                  onClick={() => retryMutation.mutate()}
                >
                  Retry matching ({outstandingMatches} outstanding)
                </Button>
              )}
              {canReconcile && (
                <Button
                  variant="secondary"
                  isLoading={reconcileMutation.isPending}
                  onClick={() => reconcileMutation.mutate()}
                >
                  Trigger reconciliation
                </Button>
              )}
            </div>
          </Container>

          {progress && progress.totalProposals > 0 && (
            <Container className="flex flex-col gap-3 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Heading level="h2">Inventory proposals</Heading>
                <Link to={`/imports/snapshots/${encodeURIComponent(snapshotId)}/proposals`}>Review proposals</Link>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle">Pending review</Text>
                  <Text size="small">{progress.pending}</Text>
                </div>
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle">Approved, unapplied</Text>
                  <Text size="small">{progress.approved}</Text>
                </div>
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle">Applied and synced</Text>
                  <Text size="small">{progress.appliedFullySynced}</Text>
                </div>
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle">Applied, sync pending or failed</Text>
                  <Text size="small">{progress.appliedSyncPending + progress.appliedSyncFailed}</Text>
                </div>
              </div>
              <Text size="small" className={progress.fullyComplete ? "text-ui-fg-subtle" : "text-ui-fg-subtle"}>
                {progress.fullyComplete
                  ? "All applicable proposals have been applied and synchronised to Medusa."
                  : "This snapshot is not fully applied yet."}
              </Text>
            </Container>
          )}

          <Container className="flex flex-col gap-3 p-0">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <Heading level="h2">Rows</Heading>
              {entryIdFilter && (
                <Button size="small" variant="secondary" onClick={() => setEntryIdFilter("")}>Show all rows</Button>
              )}
              <select
                aria-label="Filter by outcome"
                value={outcomeFilter}
                onChange={(event) => { setOutcomeFilter(event.target.value); setEntryOffset(0) }}
                className="rounded-none border p-1 text-sm"
              >
                <option value="">All outcomes</option>
                <option value="VALID">Valid</option>
                <option value="VALID_WITH_WARNINGS">Valid, with warnings</option>
                <option value="UNRESOLVED_VARIANT">Variant not resolved</option>
                <option value="REVIEW_REQUIRED">Needs review</option>
                <option value="INVALID">Invalid</option>
                <option value="SKIPPED">Skipped</option>
              </select>
              <select
                aria-label="Filter by review status"
                value={matchingStatusFilter}
                onChange={(event) => { setMatchingStatusFilter(event.target.value); setEntryOffset(0) }}
                className="rounded-none border p-1 text-sm"
              >
                <option value="">All review statuses</option>
                <option value="UNMATCHED">Not matched</option>
                <option value="MATCHED">Matched</option>
                <option value="AMBIGUOUS">Ambiguous</option>
                <option value="REVIEW_REQUIRED">Needs review</option>
              </select>
            </div>
            <ReviewTable
              columns={entryColumns}
              rows={entriesQuery.data?.entries ?? []}
              rowKey={(row) => row.id}
              isLoading={entriesQuery.isLoading}
              isError={entriesQuery.isError}
              emptyMessage="No rows match this filter."
            />
            {entriesQuery.data && (
              <PaginationBar
                offset={entryOffset}
                limit={entriesQuery.data.limit}
                count={entriesQuery.data.count}
                onOffsetChange={setEntryOffset}
              />
            )}
          </Container>

          <Container className="flex flex-col gap-3 p-0">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <Heading level="h2">Diagnostics</Heading>
              <select
                aria-label="Filter by severity"
                value={severityFilter}
                onChange={(event) => { setSeverityFilter(event.target.value); setDiagnosticOffset(0) }}
                className="rounded-none border p-1 text-sm"
              >
                <option value="">All severities</option>
                <option value="ERROR">Error</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </select>
            </div>
            <ReviewTable
              columns={diagnosticColumns}
              rows={diagnosticsQuery.data?.diagnostics ?? []}
              rowKey={(row) => row.id}
              isLoading={diagnosticsQuery.isLoading}
              isError={diagnosticsQuery.isError}
              emptyMessage="No diagnostics for this filter."
            />
            {diagnosticsQuery.data && (
              <PaginationBar
                offset={diagnosticOffset}
                limit={diagnosticsQuery.data.limit}
                count={diagnosticsQuery.data.count}
                onOffsetChange={setDiagnosticOffset}
              />
            )}
          </Container>
        </>
      )}
    </div>
  )
}

export default ImportsSnapshotDetailPage
