import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import CardImageThumbnail from "../../../../components/imports/card-image-thumbnail"
import CreateCardDialog from "../../../../components/imports/create-card-dialog"
import EntryDetailDrawer from "../../../../components/imports/entry-detail-drawer"
import { fetchJson, postAction } from "../../../../components/imports/fetch-json"
import { formatMoney } from "../../../../components/imports/format-money"
import ImportStepper from "../../../../components/imports/import-stepper"
import MatchingStatusBadge from "../../../../components/imports/matching-status-badge"
import PaginationBar from "../../../../components/imports/pagination-bar"
import ReplaceCardImageDialog from "../../../../components/imports/replace-card-image-dialog"
import ReviewTable, { type ReviewTableColumn } from "../../../../components/imports/review-table"
import RowOutcomeBadge from "../../../../components/imports/row-outcome-badge"
import { formatEnumLabel } from "../../../../components/imports/format-enum-label"
import type { VariantThumbnailsResponse } from "../../../../components/imports/image-types"
import type {
  ImportSummary, InventoryProposalListItem, InventoryProposalListResponse, RetryMatchingResult,
  SnapshotDiagnosticListItem, SnapshotDiagnosticListResponse,
  SnapshotEntryListItem, SnapshotEntryListResponse, SnapshotProgress,
} from "../../../../components/imports/pulse-import-types"
import "../../../../styles/imports.css"

const ENTRY_PAGE_SIZE = 20
const DIAGNOSTIC_PAGE_SIZE = 20

const OUTSTANDING_MATCHING_STATUSES = ["UNMATCHED", "AMBIGUOUS", "REVIEW_REQUIRED"]

const DIAGNOSTIC_SEVERITY_COLOR: Record<string, "red" | "orange" | "green" | "grey"> = {
  ERROR: "red", WARNING: "orange", INFO: "green",
}

const DIAGNOSTIC_ROW_TINT: Record<string, string> = {
  ERROR: "bg-ui-tag-red-bg", WARNING: "bg-ui-tag-orange-bg", INFO: "bg-ui-tag-green-bg",
}

function fetchSummary(snapshotId: string): Promise<{ summary: ImportSummary; progress: SnapshotProgress }> {
  return fetchJson(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`)
}

const ImportsSnapshotDetailPage = () => {
  const params = useParams<{ id: string }>()
  const snapshotId = params.id ?? ""
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [entryOffset, setEntryOffset] = useState(0)
  const [outcomeFilter, setOutcomeFilter] = useState("")
  const [matchingStatusFilter, setMatchingStatusFilter] = useState("")
  const [entryIdFilter, setEntryIdFilter] = useState("")
  const [diagnosticOffset, setDiagnosticOffset] = useState(0)
  const [severityFilter, setSeverityFilter] = useState("")
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [replaceImageTarget, setReplaceImageTarget] = useState<{ tradingCardId: string; tradingCardVariantId: string } | null>(null)
  const [createCardRow, setCreateCardRow] = useState<InventoryProposalListItem | null>(null)

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
    enabled: Boolean(snapshotId) && diagnosticsExpanded,
    placeholderData: keepPreviousData,
  })

  const visibleVariantIds = [
    ...new Set((entriesQuery.data?.entries ?? []).map((entry) => entry.tradingCardVariantId).filter((id): id is string => Boolean(id))),
  ]
  const thumbnailsQuery = useQuery({
    queryKey: ["pulse-import-thumbnails", snapshotId, visibleVariantIds],
    queryFn: () => fetchJson<VariantThumbnailsResponse>(
      `/admin/trading-cards/variants/images?variantIds=${visibleVariantIds.map(encodeURIComponent).join(",")}`,
    ),
    enabled: visibleVariantIds.length > 0,
    placeholderData: keepPreviousData,
  })

  // Rows without a matched card need "Create card" before they can have an
  // image at all — this fetches the corresponding proposals (by shared
  // `providerReference`) so clicking a placeholder can open the same dialog
  // used on the proposals page, without navigating away first.
  const unresolvedProposalsQuery = useQuery({
    queryKey: ["pulse-import-unresolved-proposals", snapshotId],
    queryFn: () => fetchJson<InventoryProposalListResponse>(
      `/admin/trading-card-inventory/proposals?limit=100&offset=0&inventorySnapshotId=${encodeURIComponent(snapshotId)}&changeKind=UNRESOLVED_VARIANT`,
    ),
    enabled: Boolean(snapshotId),
  })
  const unresolvedProposalByReference = new Map(
    (unresolvedProposalsQuery.data?.proposals ?? [])
      .filter((proposal) => proposal.providerReference)
      .map((proposal) => [proposal.providerReference as string, proposal]),
  )

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
    {
      header: "Card",
      cell: (row) => {
        const thumbnail = row.tradingCardVariantId ? thumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        if (row.tradingCardVariantId) {
          const target = thumbnail?.tradingCardId
            ? { tradingCardId: thumbnail.tradingCardId, tradingCardVariantId: row.tradingCardVariantId }
            : null
          return (
            <CardImageThumbnail
              imageUrl={thumbnail?.imageUrl ?? null}
              alt={row.providerReference}
              title={target ? (thumbnail?.imageUrl ? "Click to replace the image" : "Click to add a photo") : undefined}
              onClick={target ? () => setReplaceImageTarget(target) : undefined}
            />
          )
        }
        const proposal = row.providerReference ? unresolvedProposalByReference.get(row.providerReference) : undefined
        return (
          <CardImageThumbnail
            imageUrl={null}
            alt={row.providerReference}
            title={proposal ? "Click to create this card" : undefined}
            onClick={proposal ? () => setCreateCardRow(proposal) : undefined}
          />
        )
      },
    },
    { header: "Row", cell: (row) => row.rowNumber ?? "—" },
    { header: "Reference", cell: (row) => row.providerReference },
    { header: "Quantity", cell: (row) => row.quantity },
    { header: "Purchase price", cell: (row) => formatMoney(row.unitAcquisitionCost, row.currencyCode) },
    { header: "Market value", cell: (row) => formatMoney(row.unitMarketPrice, row.currencyCode) },
    { header: "Sale price", cell: (row) => formatMoney(row.unitSellingPrice, row.currencyCode) },
    { header: "Finish", cell: (row) => formatEnumLabel(row.finishCandidate) },
    { header: "Treatment", cell: (row) => formatEnumLabel(row.specialTreatmentCandidate) },
    { header: "Rarity", cell: (row) => row.rarityCandidate ? formatEnumLabel(row.rarityCandidate) : (row.rarityRaw ?? "—") },
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
    { header: "Severity", cell: (row) => <Badge className="ht-imports-badge" size="2xsmall" color={DIAGNOSTIC_SEVERITY_COLOR[row.severity] ?? "grey"}>{row.severity}</Badge> },
    { header: "Field", cell: (row) => row.fieldRef ?? "—" },
    { header: "Message", cell: (row) => row.message },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Import preview</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          This shows what is in the uploaded file before anything happens to your stock. If
          "Retry matching" is shown, some rows still need matching to a card — try it after you
          have added or fixed cards. Once the file looks right, use "Trigger reconciliation" to
          work out the stock changes, then go to "Review proposals" to approve them.
        </Text>
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
                <Link to={`/imports/snapshots/${encodeURIComponent(snapshotId)}/proposals`} className="text-ui-fg-subtle text-sm">
                  View proposals
                </Link>
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
              <Text size="small" className="text-ui-fg-subtle">
                {progress.fullyComplete
                  ? "All applicable proposals have been applied and synchronised to Medusa."
                  : "This snapshot is not fully applied yet."}
              </Text>
              {!progress.fullyComplete && (
                <Button onClick={() => navigate(`/imports/snapshots/${encodeURIComponent(snapshotId)}/proposals`)}>
                  Next: Review proposals →
                </Button>
              )}
              {progress.fullyComplete && (
                <Button onClick={() => navigate(`/imports/images?snapshotId=${encodeURIComponent(snapshotId)}`)}>
                  Next: Assign card images →
                </Button>
              )}
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
              onRowClick={(row) => setSelectedEntryId(row.id)}
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
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-3 p-4 text-left"
              onClick={() => setDiagnosticsExpanded((expanded) => !expanded)}
              aria-expanded={diagnosticsExpanded}
            >
              <Text size="small" className="text-ui-fg-subtle">{diagnosticsExpanded ? "⌄" : "›"}</Text>
              <Heading level="h2">Diagnostics</Heading>
              {!diagnosticsExpanded && <Text size="small" className="text-ui-fg-subtle">Click to expand</Text>}
            </button>
            {diagnosticsExpanded && (
              <>
                <div className="flex flex-wrap items-center gap-3 px-4 pb-2">
                  <select
                    aria-label="Filter by severity"
                    value={severityFilter}
                    onChange={(event) => { setSeverityFilter(event.target.value); setDiagnosticOffset(0) }}
                    className="rounded-none border p-1 text-sm"
                  >
                    <option value="">All severities</option>
                    <option value="ERROR">Error — blockers</option>
                    <option value="WARNING">Warning — concerns</option>
                    <option value="INFO">Info — non-blocking, ok</option>
                  </select>
                </div>
                <ReviewTable
                  columns={diagnosticColumns}
                  rows={diagnosticsQuery.data?.diagnostics ?? []}
                  rowKey={(row) => row.id}
                  rowClassName={(row) => DIAGNOSTIC_ROW_TINT[row.severity]}
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
              </>
            )}
          </Container>
        </>
      )}

      {selectedEntryId && (() => {
        const selectedEntry = entriesQuery.data?.entries.find((entry) => entry.id === selectedEntryId)
        if (!selectedEntry) return null
        const thumbnail = selectedEntry.tradingCardVariantId
          ? thumbnailsQuery.data?.thumbnails[selectedEntry.tradingCardVariantId]
          : undefined
        return (
          <EntryDetailDrawer
            snapshotId={snapshotId}
            row={selectedEntry}
            thumbnail={thumbnail}
            onClose={() => setSelectedEntryId(null)}
          />
        )
      })()}

      {replaceImageTarget && (
        <ReplaceCardImageDialog
          tradingCardId={replaceImageTarget.tradingCardId}
          tradingCardVariantId={replaceImageTarget.tradingCardVariantId}
          onClose={() => setReplaceImageTarget(null)}
          onUploaded={() => queryClient.invalidateQueries({ queryKey: ["pulse-import-thumbnails", snapshotId] })}
        />
      )}

      {createCardRow && (
        <CreateCardDialog
          row={createCardRow}
          onClose={() => setCreateCardRow(null)}
          onCreated={() => {
            refreshAfterAction()
            queryClient.invalidateQueries({ queryKey: ["pulse-import-unresolved-proposals", snapshotId] })
            queryClient.invalidateQueries({ queryKey: ["pulse-import-thumbnails", snapshotId] })
          }}
        />
      )}
    </div>
  )
}

export default ImportsSnapshotDetailPage
