import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import CardImageThumbnail from "../../../../components/imports/card-image-thumbnail"
import { rememberActiveImportSnapshot } from "../../../../components/imports/active-import-session"
import CreateCardDialog from "../../../../components/imports/create-card-dialog"
import EntryDetailDrawer from "../../../../components/imports/entry-detail-drawer"
import { fetchJson, postAction } from "../../../../components/imports/fetch-json"
import { formatMoney } from "../../../../components/imports/format-money"
import ImagePreviewModal from "../../../../components/imports/image-preview-modal"
import ImportStepper from "../../../../components/imports/import-stepper"
import MatchingStatusBadge from "../../../../components/imports/matching-status-badge"
import PaginationBar from "../../../../components/imports/pagination-bar"
import ReplaceCardImageDialog from "../../../../components/imports/replace-card-image-dialog"
import ReviewTable, { type ReviewTableColumn } from "../../../../components/imports/review-table"
import SelectAllCheckbox from "../../../../components/imports/select-all-checkbox"
import SetMappingBanner from "../../../../components/imports/set-mapping-banner"
import { useRangeSelection } from "../../../../components/imports/use-range-selection"
import { formatEnumLabel } from "../../../../components/imports/format-enum-label"
import type { VariantThumbnailsResponse } from "../../../../components/imports/image-types"
import type {
  ImageReadiness, ImportSummary, InventoryProposalListItem, InventoryProposalListResponse,
  SnapshotDiagnosticListItem, SnapshotDiagnosticListResponse,
  SnapshotEntryListItem, SnapshotEntryListResponse, SnapshotProgress,
} from "../../../../components/imports/pulse-import-types"
import "../../../../styles/imports.css"

const ENTRY_PAGE_SIZE = 20
const DIAGNOSTIC_PAGE_SIZE = 20

const OUTCOME_FILTER_OPTIONS = [
  { value: "VALID", label: "Valid" },
  { value: "VALID_WITH_WARNINGS", label: "Valid, with warnings" },
  { value: "UNRESOLVED_VARIANT", label: "Variant not resolved" },
  { value: "REVIEW_REQUIRED", label: "Needs review" },
  { value: "INVALID", label: "Invalid" },
  { value: "SKIPPED", label: "Skipped" },
] as const

const DIAGNOSTIC_SEVERITY_COLOR: Record<string, "red" | "orange" | "green" | "grey"> = {
  ERROR: "red", WARNING: "orange", INFO: "green",
}

const DIAGNOSTIC_ROW_TINT: Record<string, string> = {
  ERROR: "bg-ui-tag-red-bg", WARNING: "bg-ui-tag-orange-bg", INFO: "bg-ui-tag-green-bg",
}

type EntrySortKey = "cardName" | "set" | "quantity" | "purchasePrice" | "marketPrice" | "salePrice" | "finish" | "variant" | "rarity" | "reviewStatus"
type SortDirection = "asc" | "desc"

function fetchSummary(snapshotId: string): Promise<{ summary: ImportSummary; progress: SnapshotProgress; imageReadiness: ImageReadiness }> {
  return fetchJson(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`)
}

const ImportsSnapshotDetailPage = () => {
  const params = useParams<{ id: string }>()
  const snapshotId = params.id ?? ""
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [entryOffset, setEntryOffset] = useState(0)
  const [outcomeFilter, setOutcomeFilter] = useState("")
  const [reviewStatusFilter, setReviewStatusFilter] = useState("ACTION_REQUIRED")
  const [entryIdFilter, setEntryIdFilter] = useState("")
  const [diagnosticOffset, setDiagnosticOffset] = useState(0)
  const [severityFilter, setSeverityFilter] = useState("")
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [replaceImageTarget, setReplaceImageTarget] = useState<{ tradingCardId: string; tradingCardVariantId: string } | null>(null)
  const [createCardRow, setCreateCardRow] = useState<InventoryProposalListItem | null>(null)
  const [previewImage, setPreviewImage] = useState<{
    imageUrl: string; alt: string; target: { tradingCardId: string; tradingCardVariantId: string }
  } | null>(null)
  const [entrySort, setEntrySort] = useState<{ key: EntrySortKey; direction: SortDirection }>({
    key: "cardName",
    direction: "asc",
  })

  useEffect(() => {
    rememberActiveImportSnapshot(snapshotId)
  }, [snapshotId])

  const summaryQuery = useQuery({
    queryKey: ["pulse-import-summary", snapshotId],
    queryFn: () => fetchSummary(snapshotId),
    enabled: Boolean(snapshotId),
  })

  const entriesQuery = useQuery({
    queryKey: ["pulse-import-entries", snapshotId, { entryOffset, outcomeFilter, reviewStatusFilter, entryIdFilter, entrySort }],
    queryFn: () => {
      const searchParams = new URLSearchParams({ limit: String(ENTRY_PAGE_SIZE), offset: String(entryOffset) })
      searchParams.set("sortBy", entrySort.key)
      searchParams.set("sortDirection", entrySort.direction)
      if (outcomeFilter) searchParams.set("outcome", outcomeFilter)
      if (reviewStatusFilter) searchParams.set("reviewStatus", reviewStatusFilter)
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

  // A row is only selectable while it's still a plain pending TCGdex match —
  // once it has a real card, or its candidate is already ACCEPTED (including
  // an accepted-but-skipped row waiting on "Create card" instead), it drops
  // out of the bulk accept/reject flow. Almost every not-yet-created row has
  // an unresolved proposal — that alone isn't the right signal.
  const isCandidateSelectable = (row: SnapshotEntryListItem) =>
    Boolean(row.tcgdexCandidate) && !row.tradingCardVariantId && row.tcgdexCandidate!.reviewStatus !== "ACCEPTED"
  const selection = useRangeSelection<SnapshotEntryListItem>(
    (row) => row.tcgdexCandidate!.id,
    isCandidateSelectable,
  )

  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["pulse-import-summary", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["pulse-import-entries", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["pulse-import-diagnostics", snapshotId] })
  }

  const reconcileMutation = useMutation({
    mutationFn: () =>
      postAction(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/reconcile`),
    onSuccess: () => {
      toast.success("Reconciliation started")
      refreshAfterAction()
    },
    onError: () => toast.error("Reconciliation could not be started. Please try again."),
  })

  const reviewCandidatesMutation = useMutation({
    mutationFn: ({ candidateIds, action }: { candidateIds: string[]; action: "ACCEPT" | "REJECT" }) =>
      postAction<{ results: Array<{ candidateId: string; createdVariantCount: number; skippedRowCount: number; errors: string[] }> }>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/review`,
        { candidateIds, action },
      ),
    onSuccess: (response, variables) => {
      if (variables.action === "REJECT") {
        toast.success(`${response.results.length} match${response.results.length === 1 ? "" : "es"} rejected`)
      } else {
        const created = response.results.reduce((sum, r) => sum + r.createdVariantCount, 0)
        const skipped = response.results.reduce((sum, r) => sum + r.skippedRowCount, 0)
        const failed = response.results.filter((r) => r.errors.length > 0)
        const parts = [`${created} card variant${created === 1 ? "" : "s"} created`]
        if (skipped > 0) parts.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped (finish/variant unclear)`)
        if (failed.length > 0) parts.push(`${failed.length} match${failed.length === 1 ? "" : "es"} had errors`)
        if (failed.length > 0) {
          // The count alone hides the actual cause — surface the real
          // per-row error strings the workflow recorded so this is
          // diagnosable without reading server logs.
          const detail = failed.flatMap((r) => r.errors).join(" | ")
          toast.error(parts.join(", "), { description: detail })
        } else {
          toast.success(parts.join(", "))
        }
      }
      selection.clear()
      refreshAfterAction()
    },
    onError: () => toast.error("This action could not be completed. Please try again."),
  })

  const summary = summaryQuery.data?.summary
  const progress = summaryQuery.data?.progress
  const imageReadiness = summaryQuery.data?.imageReadiness
  const canReconcile = summary?.status === "VALIDATED"

  const sortableHeader = (label: string, key: EntrySortKey) => {
    const isActive = entrySort.key === key
    const arrow = isActive ? (entrySort.direction === "asc" ? "↑" : "↓") : "↕"
    return (
      <button
        type="button"
        className="flex items-center gap-1 whitespace-nowrap"
        aria-label={`Sort by ${label}`}
        onClick={() => {
          setEntrySort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
          }))
          setEntryOffset(0)
        }}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={isActive ? "text-ui-fg-base" : "text-ui-fg-muted"}>{arrow}</span>
      </button>
    )
  }

  const sortedEntries = entriesQuery.data?.entries ?? []

  const entryColumns: ReviewTableColumn<SnapshotEntryListItem>[] = [
    {
      header: "Select",
      headerCell: (
        <SelectAllCheckbox
          state={selection.headerState(sortedEntries)}
          onToggle={() => selection.toggleAllVisible(sortedEntries)}
          ariaLabel="Select all TCGdex matches on this page"
        />
      ),
      cell: (row) => {
        if (!isCandidateSelectable(row)) return null
        return (
          <input
            type="checkbox"
            aria-label={`Select ${row.tcgdexCandidate!.name}`}
            checked={selection.selected.has(row.tcgdexCandidate!.id)}
            onChange={() => {}}
            onClick={(event) => {
              event.stopPropagation()
              selection.handleRowClick(row, sortedEntries.filter(isCandidateSelectable), { shiftKey: event.shiftKey })
            }}
          />
        )
      },
    },
    {
      header: "Card",
      cell: (row) => {
        const thumbnail = row.tradingCardVariantId ? thumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        if (row.tradingCardVariantId) {
          const imageUrl = thumbnail?.imageUrl ?? row.tcgdexCandidate?.referenceArtworkUrl ?? null
          const target = thumbnail?.tradingCardId
            ? { tradingCardId: thumbnail.tradingCardId, tradingCardVariantId: row.tradingCardVariantId }
            : null
          return (
            <CardImageThumbnail
              imageUrl={imageUrl}
              alt={row.providerReference}
              title={target ? (imageUrl ? "Click to view the image" : "Click to add a photo") : undefined}
              onClick={target
                ? () => {
                    if (imageUrl) {
                      setPreviewImage({ imageUrl, alt: row.providerReference, target })
                    } else {
                      setReplaceImageTarget(target)
                    }
                  }
                : undefined}
            />
          )
        }
        // A candidate can be ACCEPTED (Step 2's bulk Accept) while some of
        // its rows still couldn't be created — finish/condition unresolved
        // even after the TCGdex-variants fallback. That row's candidate is
        // ACCEPTED despite still having no real card, so it must fall
        // through to "Click to create this card" below rather than the
        // pending-review thumbnail, which would otherwise leave it stuck
        // with no way to finish creating it. A still-PENDING candidate (the
        // common case — almost every unresolved row has a proposal, that
        // alone isn't the signal) keeps showing the normal thumbnail.
        if (row.tcgdexCandidate && row.tcgdexCandidate.reviewStatus !== "ACCEPTED") {
          return <CardImageThumbnail imageUrl={row.tcgdexCandidate.referenceArtworkUrl} alt={row.tcgdexCandidate.name} />
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
    {
      header: "Card name",
      headerCell: sortableHeader("Card name", "cardName"),
      cell: (row) => {
        if (row.card) {
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">{row.card.name}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">Card {row.card.cardNumber}</Text>
            </div>
          )
        }
        if (row.tcgdexCandidate) {
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">{row.tcgdexCandidate.name}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {[row.tcgdexCandidate.seriesName, row.tcgdexCandidate.setName].filter(Boolean).join(" · ")}
              </Text>
            </div>
          )
        }
        if (row.cardIdentityHint) {
          return (
            <div className="flex flex-col">
              <Text size="small" className="text-ui-fg-subtle">Not yet matched</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">{row.cardIdentityHint}</Text>
            </div>
          )
        }
        return <Text size="small" className="text-ui-fg-subtle">Not yet matched</Text>
      },
    },
    {
      header: "Set",
      headerCell: sortableHeader("Set", "set"),
      cell: (row) => row.card?.setDisplayName ?? row.tcgdexCandidate?.setName ?? "—",
    },
    { header: "Quantity", headerCell: sortableHeader("Quantity", "quantity"), cell: (row) => row.quantity },
    { header: "Purchase price", headerCell: sortableHeader("Purchase price", "purchasePrice"), cell: (row) => formatMoney(row.unitAcquisitionCost, row.currencyCode) },
    { header: "Market value", headerCell: sortableHeader("Market value", "marketPrice"), cell: (row) => formatMoney(row.unitMarketPrice, row.currencyCode) },
    { header: "Sale price", headerCell: sortableHeader("Sale price", "salePrice"), cell: (row) => formatMoney(row.unitSellingPrice, row.currencyCode) },
    { header: "Finish", headerCell: sortableHeader("Finish", "finish"), cell: (row) => formatEnumLabel(row.finishCandidate) },
    { header: "Variant", headerCell: sortableHeader("Variant", "variant"), cell: (row) => formatEnumLabel(row.specialTreatmentCandidate) },
    { header: "Rarity", headerCell: sortableHeader("Rarity", "rarity"), cell: (row) => {
      const importedRarity = row.rarityRaw && row.rarityRaw !== "—" ? row.rarityRaw : null
      return row.rarityCandidate
        ? formatEnumLabel(row.rarityCandidate)
        : (importedRarity ?? row.card?.rarityRaw ?? row.tcgdexCandidate?.providerRarity ?? "—")
    } },
    { header: "Review status", headerCell: sortableHeader("Review status", "reviewStatus"), cell: (row) => (
      <MatchingStatusBadge status={!row.tradingCardVariantId && row.tcgdexCandidate?.reviewStatus !== "ACCEPTED" ? "AWAITING_REVIEW" : row.matchingStatus} />
    ) },
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
          This shows what is in the uploaded file before anything happens to your stock. Accept
          any TCGdex matches below, and create cards manually for anything still unmatched. Once
          the file looks right, use "Trigger reconciliation" to work out the stock changes, then
          go to "Review proposals" to approve them.
        </Text>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate("/imports/new")}>Back to upload</Button>
          {progress && progress.totalProposals > 0 && (
            !progress.fullyComplete && imageReadiness?.ready
              ? (
                  <Button onClick={() => navigate(`/imports/snapshots/${encodeURIComponent(snapshotId)}/proposals`)}>
                    Next: Review proposals →
                  </Button>
                )
              : (
                  <Button onClick={() => navigate(`/imports/images?snapshotId=${encodeURIComponent(snapshotId)}`)}>
                    Next: Assign card images →
                  </Button>
                )
          )}
        </div>
      </Container>

      <SetMappingBanner snapshotId={snapshotId} />

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
                <Text size="small">{formatEnumLabel(summary.status)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Cards</Text>
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
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Approved cards</Text>
                <Text size="small">{summary.approvedCardCount}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Approved quantity</Text>
                <Text size="small">{summary.approvedQuantity}</Text>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
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

          <Container className="flex flex-col gap-3 p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
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
                  {OUTCOME_FILTER_OPTIONS
                    .filter((option) => (summary?.byOutcome[option.value] ?? 0) > 0 || outcomeFilter === option.value)
                    .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select
                  aria-label="Filter by review status"
                  value={reviewStatusFilter}
                  onChange={(event) => { setReviewStatusFilter(event.target.value); setEntryOffset(0) }}
                  className="rounded-none border p-1 text-sm"
                >
                  <option value="ACTION_REQUIRED">Needs action</option>
                  <option value="">All review statuses</option>
                  <option value="AWAITING_REVIEW">Awaiting review</option>
                  <option value="NOT_MATCHED">Not matched</option>
                  <option value="MATCHED">Matched</option>
                  <option value="AMBIGUOUS">Ambiguous</option>
                </select>
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {selection.selected.size > 0 && (
                  <Text size="small" className="text-ui-fg-subtle">
                    {selection.selected.size} selected
                  </Text>
                )}
                <Button
                  size="small"
                  variant="primary"
                  disabled={selection.selected.size === 0}
                  isLoading={reviewCandidatesMutation.isPending}
                  onClick={() => reviewCandidatesMutation.mutate({ candidateIds: [...selection.selected], action: "ACCEPT" })}
                >
                  Approve selected
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={selection.selected.size === 0}
                  isLoading={reviewCandidatesMutation.isPending}
                  onClick={() => reviewCandidatesMutation.mutate({ candidateIds: [...selection.selected], action: "REJECT" })}
                >
                  Reject
                </Button>
              </div>
            </div>
            <ReviewTable
              className="ht-imports-rows-table"
              columns={entryColumns}
              rows={sortedEntries}
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
        const visibleEntries = sortedEntries
        const selectedEntryIndex = visibleEntries.findIndex((entry) => entry.id === selectedEntryId)
        const selectedEntry = visibleEntries[selectedEntryIndex]
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
            onPrevious={selectedEntryIndex > 0
              ? () => setSelectedEntryId(visibleEntries[selectedEntryIndex - 1].id)
              : undefined}
            onNext={selectedEntryIndex < visibleEntries.length - 1
              ? () => setSelectedEntryId(visibleEntries[selectedEntryIndex + 1].id)
              : undefined}
          />
        )
      })()}

      {previewImage && (
        <ImagePreviewModal
          imageUrl={previewImage.imageUrl}
          alt={previewImage.alt}
          onClose={() => setPreviewImage(null)}
          onReplace={() => {
            setReplaceImageTarget(previewImage.target)
            setPreviewImage(null)
          }}
        />
      )}

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
