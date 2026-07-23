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
import { parseCardNumber } from "../../../../components/imports/parse-card-number"
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
  SnapshotEntryListItem, SnapshotEntryListResponse, SnapshotProgress, UploadCsvResult,
} from "../../../../components/imports/pulse-import-types"
import "../../../../styles/imports.css"

const ENTRY_PAGE_SIZE = 20
const DIAGNOSTIC_PAGE_SIZE = 20

/** Mirrors `LookupProgress` in the dedicated tcgdex-lookup page — same `process-batch` response shape. */
interface TcgdexLookupProgress {
  totalCandidates: number
  needsSetMappingCount: number
  cachedCount: number
  processedThisBatch: number
  remaining: number
}

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

  // "Approve all card matches" must act on every MATCHED+PENDING candidate in
  // the whole snapshot, not just the current page of `sortedEntries` — this
  // dedicated, non-paginated endpoint (already used to compute per-candidate
  // row counts) is the actual source of truth for that full set.
  const allMatchedCandidatesQuery = useQuery({
    queryKey: ["all-matched-tcgdex-candidates", snapshotId],
    queryFn: () => fetchJson<{ candidates: Array<{ id: string }> }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/candidates`,
    ),
    enabled: Boolean(snapshotId),
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
  // An `AMBIGUOUS` candidate is deliberately excluded — it's a shortlist,
  // not something the accept/reject endpoint can act on directly; a reviewer
  // must resolve it via "View matches" first (which promotes it to
  // `MATCHED`), only then does it become selectable here.
  const isCandidateSelectable = (row: SnapshotEntryListItem) =>
    Boolean(row.tcgdexCandidate) && row.tcgdexCandidate!.matchOutcome === "MATCHED"
    && !row.tradingCardVariantId && row.tcgdexCandidate!.reviewStatus !== "ACCEPTED"
  const selection = useRangeSelection<SnapshotEntryListItem>(
    (row) => row.tcgdexCandidate!.id,
    isCandidateSelectable,
  )

  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["pulse-import-summary", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["pulse-import-entries", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["pulse-import-diagnostics", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["all-matched-tcgdex-candidates", snapshotId] })
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

  // Re-runs the TCGdex lookup batch (the same one driven by the dedicated
  // "Checking TCGdex" page) for every row that still needs one — the button
  // for this lives in the summary panel so a reviewer who has just confirmed
  // a provider-set-to-TCGdex mapping (via `SetMappingBanner`) can immediately
  // pick up the rows that mapping was blocking, without leaving this page.
  // This only creates/refreshes TCGdex lookup candidates for review below —
  // it never talks to local trading-card-variant matching (that's the
  // separate, narrower `retry-matching` route), so a row only becomes
  // "Matched" once its candidate is explicitly accepted.
  const [tcgdexSyncProgress, setTcgdexSyncProgress] = useState<TcgdexLookupProgress | null>(null)
  const syncUnmatchedMutation = useMutation({
    mutationFn: async () => {
      let progress: TcgdexLookupProgress
      for (;;) {
        const response = await postAction<{ progress: TcgdexLookupProgress }>(
          `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/process-batch`,
          { batchSize: 10 },
        )
        progress = response.progress
        setTcgdexSyncProgress(progress)
        if (progress.remaining <= 0) break
      }
      return progress
    },
    onSuccess: (progress) => {
      if (progress.totalCandidates === 0) {
        toast.success("Nothing needed a TCGdex lookup.")
      } else {
        const checked = progress.totalCandidates - progress.needsSetMappingCount
        toast.success(
          `TCGdex sync complete: ${checked} row${checked === 1 ? "" : "s"} checked` +
            (progress.needsSetMappingCount ? `, ${progress.needsSetMappingCount} skipped (set not mapped yet)` : "") + ".",
        )
      }
      setTcgdexSyncProgress(null)
      refreshAfterAction()
    },
    onError: () => {
      toast.error("Syncing unmatched cards against TCGdex failed. Please try again.")
      setTcgdexSyncProgress(null)
    },
  })
  const tcgdexSyncTotal = tcgdexSyncProgress?.totalCandidates ?? 0
  const tcgdexSyncDone = Math.max(0, tcgdexSyncTotal - (tcgdexSyncProgress?.remaining ?? tcgdexSyncTotal))
  const tcgdexSyncPercent = tcgdexSyncTotal > 0 ? Math.round((tcgdexSyncDone / tcgdexSyncTotal) * 100) : 0

  type CandidateReviewResult = { candidateId: string; createdVariantCount: number; skippedRowCount: number; errors: string[] }
  const REVIEW_CHUNK_SIZE = 5
  const [reviewProgress, setReviewProgress] = useState<{ done: number; total: number } | null>(null)
  const reviewCandidatesMutation = useMutation({
    mutationFn: async ({ candidateIds, action }: { candidateIds: string[]; action: "ACCEPT" | "REJECT" }) => {
      // Each candidate can create several card variants (one per duplicate CSV
      // row) — chunking rather than sending everything in one request keeps a
      // large batch visible in progress rather than looking hung for however
      // long the whole thing takes.
      const uniqueIds = [...new Set(candidateIds)]
      setReviewProgress({ done: 0, total: uniqueIds.length })
      const results: CandidateReviewResult[] = []
      for (let i = 0; i < uniqueIds.length; i += REVIEW_CHUNK_SIZE) {
        const chunk = uniqueIds.slice(i, i + REVIEW_CHUNK_SIZE)
        const response = await postAction<{ results: CandidateReviewResult[] }>(
          `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/review`,
          { candidateIds: chunk, action },
        )
        results.push(...response.results)
        setReviewProgress({ done: Math.min(i + REVIEW_CHUNK_SIZE, uniqueIds.length), total: uniqueIds.length })
      }
      return { results, action }
    },
    onSuccess: ({ results, action }) => {
      if (action === "REJECT") {
        toast.success(`${results.length} match${results.length === 1 ? "" : "es"} rejected`)
      } else {
        const created = results.reduce((sum, r) => sum + r.createdVariantCount, 0)
        const skipped = results.reduce((sum, r) => sum + r.skippedRowCount, 0)
        const failed = results.filter((r) => r.errors.length > 0)
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
    onSettled: () => setReviewProgress(null),
  })

  const summary = summaryQuery.data?.summary
  const progress = summaryQuery.data?.progress
  const imageReadiness = summaryQuery.data?.imageReadiness
  const canReconcile = summary?.status === "VALIDATED"
  // Mirrors the summary route's own `outstandingMatches` computation exactly
  // (see summary/route.ts's `loadImageReadiness`) — a row still UNMATCHED,
  // AMBIGUOUS (TCGdex found several candidates), or REVIEW_REQUIRED has no
  // card to attach a photo to yet, so Step 3 must stay blocked until every
  // row has a resolved match.
  const outstandingMatchCount = ["UNMATCHED", "AMBIGUOUS", "REVIEW_REQUIRED"]
    .reduce((sum, status) => sum + (summary?.byMatchingStatus[status] ?? 0), 0)

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
          return <CardImageThumbnail imageUrl={row.tcgdexCandidate.referenceArtworkUrl} alt={row.tcgdexCandidate.name ?? "Card pending review"} />
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
          const { cardNumber, totalNumber } = parseCardNumber(row.providerReference)
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">{row.tcgdexCandidate.name}</Text>
              {cardNumber && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Card {cardNumber}{totalNumber ? ` / ${totalNumber}` : ""}
                </Text>
              )}
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
      // A resolved variant takes priority over everything else: once a row
      // has a real trading-card variant it's genuinely done, distinct from
      // "Match found" (a TCGdex candidate exists but is still awaiting
      // approval). Otherwise keyed off the candidate's own `matchOutcome`:
      // `AMBIGUOUS` (a shortlist, not yet resolved) shows "Awaiting review";
      // `MATCHED` and not yet accepted shows "Match found"; a row with no
      // candidate at all falls back to its real `matchingStatus` (e.g. "Not matched").
      <MatchingStatusBadge status={
        row.tradingCardVariantId
          ? "CARD_MATCHED"
          : row.tcgdexCandidate?.matchOutcome === "AMBIGUOUS"
            ? "TCGDEX_AMBIGUOUS"
            : row.tcgdexCandidate?.matchOutcome === "MATCHED" && row.tcgdexCandidate.reviewStatus !== "ACCEPTED"
              ? "MATCHED"
              : row.matchingStatus
      } />
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
        <Heading level="h1">Import Stages</Heading>
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
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      disabled={outstandingMatchCount > 0}
                      onClick={() => navigate(`/imports/images?snapshotId=${encodeURIComponent(snapshotId)}`)}
                    >
                      Next: Assign card images →
                    </Button>
                    {outstandingMatchCount > 0 && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {outstandingMatchCount} row{outstandingMatchCount === 1 ? "" : "s"} still {outstandingMatchCount === 1 ? "needs" : "need"} a match before you can assign images.
                      </Text>
                    )}
                  </div>
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
          <Container className="flex flex-col gap-3 p-0">
            <div className="flex flex-col gap-3 p-6">
            <Heading level="h2">Import overview</Heading>
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

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap gap-3">
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
              <Button
                variant="secondary"
                isLoading={syncUnmatchedMutation.isPending}
                onClick={() => syncUnmatchedMutation.mutate()}
              >
                Sync not yet matched cards
              </Button>
            </div>
            </div>
            {syncUnmatchedMutation.isPending && (
              <div
                className="h-2 w-full bg-ui-bg-subtle"
                role="progressbar"
                aria-valuenow={tcgdexSyncPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Syncing not yet matched cards against TCGdex"
              >
                <div className="h-2 bg-ui-fg-interactive transition-[width]" style={{ width: `${tcgdexSyncPercent}%` }} />
              </div>
            )}
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
                  <option value="MATCHED">Match found</option>
                  <option value="AMBIGUOUS">Ambiguous (local match)</option>
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
                  variant="secondary"
                  disabled={reviewCandidatesMutation.isPending || !allMatchedCandidatesQuery.data?.candidates.length}
                  isLoading={reviewCandidatesMutation.isPending || allMatchedCandidatesQuery.isLoading}
                  onClick={() => reviewCandidatesMutation.mutate({
                    candidateIds: (allMatchedCandidatesQuery.data?.candidates ?? []).map((candidate) => candidate.id),
                    action: "ACCEPT",
                  })}
                >
                  Approve all card matches
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  disabled={reviewCandidatesMutation.isPending || selection.selected.size === 0}
                  isLoading={reviewCandidatesMutation.isPending}
                  onClick={() => reviewCandidatesMutation.mutate({ candidateIds: [...selection.selected], action: "ACCEPT" })}
                >
                  Approve selected
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={reviewCandidatesMutation.isPending || selection.selected.size === 0}
                  isLoading={reviewCandidatesMutation.isPending}
                  onClick={() => reviewCandidatesMutation.mutate({ candidateIds: [...selection.selected], action: "REJECT" })}
                >
                  Reject
                </Button>
              </div>
            </div>
            {reviewProgress && (
              <Text size="xsmall" className="px-4 text-ui-fg-subtle">
                Approving matches: {reviewProgress.done} of {reviewProgress.total} done…
              </Text>
            )}
            {reviewProgress && (
              <div
                className="h-2 w-full bg-ui-bg-subtle"
                role="progressbar"
                aria-valuenow={reviewProgress.total > 0 ? Math.round((reviewProgress.done / reviewProgress.total) * 100) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Approving matches: ${reviewProgress.done} of ${reviewProgress.total} done`}
              >
                <div
                  className="h-2 bg-ui-fg-interactive transition-[width]"
                  style={{ width: `${reviewProgress.total > 0 ? Math.round((reviewProgress.done / reviewProgress.total) * 100) : 0}%` }}
                />
              </div>
            )}
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
