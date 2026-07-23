import { Badge, Button, Container, Heading, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, type MouseEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import CategoryAssignmentDialog from "../../../../../components/imports/category-assignment-dialog"
import CreateCardDialog from "../../../../../components/imports/create-card-dialog"
import CardImageThumbnail from "../../../../../components/imports/card-image-thumbnail"
import AlternativeMatchDialog from "../../../../../components/imports/alternative-match-dialog"
import EditIllustratorDialog from "../../../../../components/imports/edit-illustrator-dialog"
import EntryDetailDrawer from "../../../../../components/imports/entry-detail-drawer"
import FailedLookupsPanel from "../../../../../components/imports/failed-lookups-panel"
import ManageGroupDialog from "../../../../../components/imports/manage-group-dialog"
import { fetchJson, postAction } from "../../../../../components/imports/fetch-json"
import ImportStepper from "../../../../../components/imports/import-stepper"
import InventoryProposalStatusBadge from "../../../../../components/imports/inventory-proposal-status-badge"
import PaginationBar from "../../../../../components/imports/pagination-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../../../components/imports/review-table"
import SelectAllCheckbox from "../../../../../components/imports/select-all-checkbox"
import { useRangeSelection } from "../../../../../components/imports/use-range-selection"
import { formatEnumLabel } from "../../../../../components/imports/format-enum-label"
import type { VariantThumbnailsResponse } from "../../../../../components/imports/image-types"
import type {
  ApplyProposalItemResult, ImageReadiness, InventoryProposalDetailResponse, InventoryProposalListItem, InventoryProposalListResponse,
  SnapshotEntryListResponse, SnapshotProgress,
} from "../../../../../components/imports/pulse-import-types"
import "../../../../../styles/imports.css"

const PAGE_SIZE = 20
const APPLICABLE_CHANGE_KINDS = new Set(["NEW_HOLDING", "QUANTITY_CHANGE"])

const CHANGE_KIND_LABEL: Record<string, string> = {
  NEW_HOLDING: "New stock",
  QUANTITY_CHANGE: "Quantity change",
  COST_CHANGE: "Cost change",
  PRICE_CHANGE: "Price change",
  NO_CHANGE: "No change",
  UNRESOLVED_VARIANT: "Needs a card",
}

// A NEW_HOLDING proposal is the first Medusa-facing appearance of this
// card's stock — the backend refuses to Apply it without a reviewer-
// confirmed eBay Store category (see `applyInventoryProposal`'s NEW_HOLDING
// gate). QUANTITY_CHANGE rows never need this: the card was already
// categorised the first time it reached NEW_HOLDING.
function needsCategoryConfirmation(row: InventoryProposalListItem): boolean {
  return row.changeKind === "NEW_HOLDING" && !row.confirmedEbayStoreCategoryId
}

function selectionKind(row: InventoryProposalListItem): "REVIEW" | "APPLY" | null {
  // A row still without a matched card isn't eligible for review/bulk-approve
  // yet — it needs "Create card" first, which is what resolves it to a real
  // variant. Selecting it here would otherwise let bulk-approve silently no-op
  // it into an APPROVED-but-never-appliable dead end.
  if (row.reviewStatus === "PENDING" && row.card !== null) return "REVIEW"
  if (row.reviewStatus === "APPROVED" && row.tradingCardVariantId && row.proposedQuantity !== null &&
    APPLICABLE_CHANGE_KINDS.has(row.changeKind) && !needsCategoryConfirmation(row)) return "APPLY"
  return null
}

function summaryQueryKey(snapshotId: string) {
  return ["pulse-import-summary", snapshotId]
}

function proposalsQueryKey(snapshotId: string, offset: number, reviewStatus: string) {
  return ["inventory-proposals", snapshotId, { offset, reviewStatus }]
}

const InventoryProposalsPage = () => {
  const params = useParams<{ id: string }>()
  const snapshotId = params.id ?? ""
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const prompt = usePrompt()

  const [offset, setOffset] = useState(0)
  const [reviewStatusFilter, setReviewStatusFilter] = useState("")
  const selection = useRangeSelection<InventoryProposalListItem>(
    (row) => row.id,
    (row) => selectionKind(row) !== null,
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [createCardRow, setCreateCardRow] = useState<InventoryProposalListItem | null>(null)
  const [selectedProposal, setSelectedProposal] = useState<InventoryProposalListItem | null>(null)
  const [categoryProposalId, setCategoryProposalId] = useState<string | null>(null)
  const [manageGroupProposalId, setManageGroupProposalId] = useState<string | null>(null)
  const [alternativeMatchEntryId, setAlternativeMatchEntryId] = useState<string | null>(null)
  const [editIllustratorCardId, setEditIllustratorCardId] = useState<string | null>(null)

  const summaryQuery = useQuery({
    queryKey: summaryQueryKey(snapshotId),
    queryFn: () => fetchJson<{
      summary: { inventorySourceId: string }; progress: SnapshotProgress; imageReadiness: ImageReadiness
    }>(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`),
    enabled: Boolean(snapshotId),
  })

  const imageReadiness = summaryQuery.data?.imageReadiness
  useEffect(() => {
    if (imageReadiness && !imageReadiness.ready) {
      navigate(`/imports/images?snapshotId=${encodeURIComponent(snapshotId)}`, { replace: true })
    }
  }, [imageReadiness, navigate, snapshotId])

  const proposalsQuery = useQuery({
    queryKey: proposalsQueryKey(snapshotId, offset, reviewStatusFilter),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(offset), inventorySnapshotId: snapshotId,
      })
      if (reviewStatusFilter) searchParams.set("reviewStatus", reviewStatusFilter)
      return fetchJson<InventoryProposalListResponse>(`/admin/trading-card-inventory/proposals?${searchParams.toString()}`)
    },
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
  })

  const historyQuery = useQuery({
    queryKey: ["inventory-proposal-detail", expandedId],
    queryFn: () => fetchJson<InventoryProposalDetailResponse>(`/admin/trading-card-inventory/proposals/${encodeURIComponent(expandedId ?? "")}`),
    enabled: Boolean(expandedId),
  })

  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: summaryQueryKey(snapshotId) })
    queryClient.invalidateQueries({ queryKey: ["inventory-proposals", snapshotId] })
    queryClient.invalidateQueries({ queryKey: ["inventory-proposal-detail"] })
    selection.clear()
  }

  const reviewOneMutation = useMutation({
    mutationFn: ({ id, targetStatus, reason }: { id: string; targetStatus: "APPROVED" | "REJECTED"; reason?: string }) =>
      postAction(`/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}/review`, {
        targetStatus, ...(reason ? { rejectionReason: reason } : {}),
      }),
    onSuccess: () => {
      toast.success("Review saved")
      refreshAfterAction()
    },
    onError: () => toast.error("This review could not be saved. Please try again."),
  })

  const bulkReviewMutation = useMutation({
    mutationFn: ({ ids, targetStatus }: { ids: string[]; targetStatus: "APPROVED" | "REJECTED" }) =>
      postAction(`/admin/trading-card-inventory/proposals/review`, { ids, targetStatus }),
    onSuccess: () => {
      toast.success("Selected proposals were reviewed")
      refreshAfterAction()
    },
    onError: () => toast.error("This batch could not be reviewed — nothing was changed. Please try again."),
  })

  const applyOneMutation = useMutation({
    mutationFn: (id: string) => postAction<{ result: ApplyProposalItemResult }>(`/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}/apply`),
    onSuccess: ({ result }) => {
      if (result.localApplicationStatus === "APPLIED" || result.localApplicationStatus === "ALREADY_APPLIED") {
        toast.success(result.medusaSyncStatus === "SYNCED" ? "Applied and synced to Medusa" : "Applied locally; Medusa sync is pending or failed")
      } else {
        toast.error(result.errorMessage ?? "This proposal could not be applied.")
      }
      refreshAfterAction()
    },
    onError: () => toast.error("This proposal could not be applied. Please try again."),
  })

  const bulkApplyMutation = useMutation({
    mutationFn: (ids: string[]) => postAction<{ results: ApplyProposalItemResult[] }>(`/admin/trading-card-inventory/proposals/apply`, { ids }),
    onSuccess: ({ results }) => {
      const appliedCount = results.filter((r) => r.localApplicationStatus === "APPLIED" || r.localApplicationStatus === "ALREADY_APPLIED").length
      toast.info(`${appliedCount} of ${results.length} selected proposals were applied`)
      refreshAfterAction()
    },
    onError: () => toast.error("This batch could not be applied. Please try again."),
  })

  const retrySyncMutation = useMutation({
    mutationFn: (id: string) => postAction(`/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}/retry-sync`),
    onSuccess: () => {
      toast.success("Medusa sync retried")
      refreshAfterAction()
    },
    onError: () => toast.error("The Medusa sync retry did not succeed. Please try again."),
  })

  const handleReject = async (id: string) => {
    const confirmed = await prompt({
      title: "Reject this proposal?",
      description: "This inventory proposal will not be applied. It will need to be re-approved via reconciliation to be considered again.",
      confirmText: "Reject",
      cancelText: "Cancel",
      variant: "danger",
    })
    if (confirmed) reviewOneMutation.mutate({ id, targetStatus: "REJECTED", reason: rejectReason.trim() || undefined })
  }

  const handleBulkReview = async (targetStatus: "APPROVED" | "REJECTED") => {
    const ids = [...selection.selected]
    if (ids.length === 0) return
    const confirmed = await prompt({
      title: targetStatus === "APPROVED" ? `Approve ${ids.length} proposals?` : `Reject ${ids.length} proposals?`,
      description: "This is all-or-nothing: if any selected proposal is no longer pending, nothing in this batch will change.",
      confirmText: targetStatus === "APPROVED" ? "Approve" : "Reject",
      cancelText: "Cancel",
      variant: targetStatus === "APPROVED" ? undefined : "danger",
    })
    if (confirmed) bulkReviewMutation.mutate({ ids, targetStatus })
  }

  const handleBulkApply = async () => {
    const ids = [...selection.selected]
    if (ids.length === 0) return
    const confirmed = await prompt({
      title: `Apply ${ids.length} proposals?`,
      description: "Each proposal is applied independently — one stale or invalid proposal will not block the others.",
      confirmText: "Apply",
      cancelText: "Cancel",
    })
    if (confirmed) bulkApplyMutation.mutate(ids)
  }

  const progress = summaryQuery.data?.progress
  const visibleRows = proposalsQuery.data?.proposals ?? []
  const categoryProposalIndex = categoryProposalId ? visibleRows.findIndex((row) => row.id === categoryProposalId) : -1
  const nextCategoryProposalId = categoryProposalIndex >= 0
    ? visibleRows.slice(categoryProposalIndex + 1).find(needsCategoryConfirmation)?.id ?? null
    : null
  const visibleVariantIds = [...new Set(
    visibleRows.map((row) => row.tradingCardVariantId).filter((id): id is string => Boolean(id)),
  )]
  const thumbnailsQuery = useQuery({
    queryKey: ["proposal-image-pairs", snapshotId, visibleVariantIds],
    queryFn: () => fetchJson<VariantThumbnailsResponse>(
      `/admin/trading-cards/variants/images?variantIds=${visibleVariantIds.map(encodeURIComponent).join(",")}`,
    ),
    enabled: visibleVariantIds.length > 0,
    placeholderData: keepPreviousData,
  })
  const selectedEntryQuery = useQuery({
    queryKey: ["proposal-snapshot-entry", snapshotId, selectedProposal?.providerReference],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: "1",
        offset: "0",
        providerReference: selectedProposal!.providerReference!,
      })
      return fetchJson<SnapshotEntryListResponse>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/entries?${params.toString()}`,
      )
    },
    enabled: Boolean(selectedProposal?.providerReference),
  })
  const selectedRows = visibleRows.filter((row) => selection.selected.has(row.id))
  const selectedKind = selectedRows.length > 0 ? selectionKind(selectedRows[0]) : null

  /**
   * Selection stays scoped to a single eligibility kind (REVIEW or APPLY) at
   * a time — selecting a row of a different kind clears the rest first.
   * Shift-click ranges are computed against only the rows sharing the
   * clicked row's kind, so a mixed-kind range silently skips the
   * out-of-kind rows in between rather than adding or erroring on them.
   */
  const handleCheckboxClick = (row: InventoryProposalListItem, event: MouseEvent) => {
    const kind = selectionKind(row)
    if (kind === null) return
    const willSelect = !selection.selected.has(row.id)
    if (willSelect) {
      const currentlySelected = visibleRows.filter((candidate) => selection.selected.has(candidate.id))
      if (currentlySelected.some((candidate) => selectionKind(candidate) !== kind)) selection.clear()
    }
    const sameKindRows = visibleRows.filter((candidate) => selectionKind(candidate) === kind)
    selection.handleRowClick(row, sameKindRows, { shiftKey: event.shiftKey })
  }

  const headerKind = visibleRows.map(selectionKind).find((kind) => kind !== null) ?? null
  const headerEligibleRows = visibleRows.filter((row) => selectionKind(row) === headerKind)
  const handleHeaderToggle = () => {
    if (headerKind === null) return
    selection.toggleAllVisible(headerEligibleRows)
  }

  const columns: ReviewTableColumn<InventoryProposalListItem>[] = [
    {
      header: "",
      headerCell: headerKind !== null
        ? <SelectAllCheckbox state={selection.headerState(headerEligibleRows)} onToggle={handleHeaderToggle} ariaLabel="Select all eligible proposals" />
        : null,
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`Select proposal ${row.id}`}
          checked={selection.selected.has(row.id)}
          disabled={selectionKind(row) === null}
          onChange={() => {}}
          onClick={(event) => { event.stopPropagation(); handleCheckboxClick(row, event) }}
        />
      ),
    },
    {
      header: "Card",
      cell: (row) => {
        if (row.card) {
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">{row.card.name}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {row.card.setDisplayName} · {row.card.cardNumber} · {formatEnumLabel(row.card.condition)} · {formatEnumLabel(row.card.finish)}
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
      header: "Uploaded image",
      cell: (row) => {
        const image = row.tradingCardVariantId ? thumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        return <CardImageThumbnail imageUrl={image?.photoUrl ?? null} alt={`Uploaded image for ${row.card?.name ?? row.cardIdentityHint ?? "unmatched card"}`} />
      },
    },
    {
      header: "TCGDex image",
      cell: (row) => {
        const image = row.tradingCardVariantId ? thumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        return <CardImageThumbnail imageUrl={image?.tcgdexImageUrl ?? null} alt={`TCGDex image for ${row.card?.name ?? row.cardIdentityHint ?? "unmatched card"}`} />
      },
    },
    { header: "Change", cell: (row) => CHANGE_KIND_LABEL[row.changeKind] ?? formatEnumLabel(row.changeKind) },
    { header: "Quantity", cell: (row) => `${row.previousQuantity ?? 0} → ${row.proposedQuantity ?? 0}` },
    { header: "Status", cell: (row) => <InventoryProposalStatusBadge reviewStatus={row.reviewStatus} medusaSyncStatus={row.medusaSyncStatus} /> },
    {
      header: "eBay category",
      cell: (row) => {
        if (row.changeKind !== "NEW_HOLDING") return <Text size="small" className="text-ui-fg-subtle">—</Text>
        if (row.confirmedEbayStoreCategoryId) return <Badge size="2xsmall" color="green">Confirmed</Badge>
        if (row.proposedEbayStoreCategoryId) {
          return (
            <div className="flex flex-col items-start" onClick={(event) => event.stopPropagation()}>
              <Badge size="2xsmall" color="orange">Needs confirmation</Badge>
              <button type="button" className="text-ui-fg-interactive text-xs" onClick={() => setCategoryProposalId(row.id)}>
                Review proposed category
              </button>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-start" onClick={(event) => event.stopPropagation()}>
            <Badge size="2xsmall" color="red">No category proposed</Badge>
            <button type="button" className="text-ui-fg-interactive text-xs" onClick={() => setCategoryProposalId(row.id)}>
              Choose a category
            </button>
          </div>
        )
      },
    },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {row.reviewStatus === "PENDING" && row.card === null && (
            <>
              <Button size="small" variant="secondary" onClick={() => setCreateCardRow(row)}>
                Create card
              </Button>
              <Text size="xsmall" className="text-ui-fg-subtle">Create the card first, then approve</Text>
            </>
          )}
          {row.reviewStatus === "PENDING" && row.card !== null && (
            <>
              <Button size="small" variant="primary" isLoading={reviewOneMutation.isPending}
                onClick={() => reviewOneMutation.mutate({ id: row.id, targetStatus: "APPROVED" })}>
                Approve
              </Button>
              <Button size="small" variant="danger" isLoading={reviewOneMutation.isPending} onClick={() => handleReject(row.id)}>
                Reject
              </Button>
            </>
          )}
          {selectionKind(row) === "APPLY" && (
            <Button size="small" variant="primary" isLoading={applyOneMutation.isPending} onClick={() => applyOneMutation.mutate(row.id)}>
              Apply
            </Button>
          )}
          {row.reviewStatus === "APPROVED" && needsCategoryConfirmation(row) && (
            <Text size="xsmall" className="text-ui-fg-subtle">Confirm the eBay category before this can be applied</Text>
          )}
          {row.reviewStatus === "APPLIED" && row.medusaSyncStatus === "FAILED" && (
            <Button size="small" variant="secondary" isLoading={retrySyncMutation.isPending} onClick={() => retrySyncMutation.mutate(row.id)}>
              Retry sync
            </Button>
          )}
          <Button size="small" variant="transparent" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
            {expandedId === row.id ? "Hide history" : "History"}
          </Button>
          {row.reviewStatus === "PENDING" && (
            <Button size="small" variant="transparent" onClick={() => setManageGroupProposalId(row.id)}>
              Manage group
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Review inventory proposals</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          Each row is a suggested stock change from the file you uploaded. What to do, per row:
        </Text>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-ui-fg-subtle text-sm">
          <li><Text size="small" weight="plus" className="inline">Not yet matched?</Text> Click "Create card", confirming condition/finish/treatment yourself — this is normal, not an error.</li>
          <li>Once a row shows a matched card, <Text size="small" weight="plus" className="inline">Approve</Text> or <Text size="small" weight="plus" className="inline">Reject</Text> it.</li>
          <li>Once approved, <Text size="small" weight="plus" className="inline">Apply</Text> it to actually update Medusa stock.</li>
        </ol>
        <Text size="small" className="text-ui-fg-subtle">
          To act on several rows at once: tick their boxes (or hold Shift and click to select a
          range), then use the bulk action that appears above the table.
        </Text>
        <Text size="small">
          <Link to={`/imports/snapshots/${encodeURIComponent(snapshotId)}`}>Back to snapshot</Link>
        </Text>
      </Container>

      {progress && (
        <Container className="flex flex-wrap gap-4 p-6">
          <Badge size="2xsmall" color={progress.pending > 0 ? "orange" : "grey"}>Pending {progress.pending}</Badge>
          <Badge size="2xsmall" color="blue">Approved, unapplied {progress.approved}</Badge>
          <Badge size="2xsmall" color="red">Rejected {progress.rejected}</Badge>
          <Badge size="2xsmall" color="green">Applied + synced {progress.appliedFullySynced}</Badge>
          <Badge size="2xsmall" color="orange">Applied, sync pending {progress.appliedSyncPending}</Badge>
          <Badge size="2xsmall" color="red">Applied, sync failed {progress.appliedSyncFailed}</Badge>
          {progress.blocked > 0 && <Badge size="2xsmall" color="red">Blocked — needs re-approval {progress.blocked}</Badge>}
          {progress.fullyComplete && <Badge size="2xsmall" color="green">Snapshot fully applied</Badge>}
        </Container>
      )}

      <FailedLookupsPanel snapshotId={snapshotId} onRetried={refreshAfterAction} />

      {progress?.fullyComplete && (
        <Container className="flex flex-col gap-3 p-6">
          <Text size="small" className="text-ui-fg-subtle">
            All applicable proposals have been applied and synchronised to Medusa. This import is complete.
          </Text>
          <Button onClick={() => navigate("/inventory")}>
            View in Inventory →
          </Button>
        </Container>
      )}

      <Container className="flex flex-col gap-3 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Heading level="h2">Proposals</Heading>
            <select
              aria-label="Filter by review status"
              value={reviewStatusFilter}
              onChange={(event) => { setReviewStatusFilter(event.target.value); setOffset(0) }}
              className="rounded-none border p-1 text-sm"
            >
              <option value="">All review statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="APPLIED">Applied</option>
            </select>
          </div>
          {selection.selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Text size="small" className="text-ui-fg-subtle">{selection.selected.size} selected</Text>
              {selectedKind === "REVIEW" && (
                <>
                  <Button size="small" variant="primary" isLoading={bulkReviewMutation.isPending} onClick={() => handleBulkReview("APPROVED")}>
                    Approve selected
                  </Button>
                  <Button size="small" variant="danger" isLoading={bulkReviewMutation.isPending} onClick={() => handleBulkReview("REJECTED")}>
                    Reject selected
                  </Button>
                </>
              )}
              {selectedKind === "APPLY" && (
                <Button size="small" variant="secondary" isLoading={bulkApplyMutation.isPending} onClick={handleBulkApply}>
                  Apply selected
                </Button>
              )}
            </div>
          )}
        </div>

        <ReviewTable
          columns={columns}
          rows={proposalsQuery.data?.proposals ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelectedProposal(row)}
          isLoading={proposalsQuery.isLoading}
          isError={proposalsQuery.isError}
          emptyMessage="No proposals match this filter."
        />
        {proposalsQuery.data && (
          <PaginationBar
            offset={offset}
            limit={proposalsQuery.data.limit}
            count={proposalsQuery.data.count}
            onOffsetChange={setOffset}
          />
        )}
      </Container>

      {expandedId && (
        <Container className="flex flex-col gap-3 p-6">
          <Heading level="h2">History for {expandedId}</Heading>
          {historyQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
          {historyQuery.data && historyQuery.data.history.length === 0 && (
            <Text size="small" className="text-ui-fg-subtle">No history yet.</Text>
          )}
          {historyQuery.data && historyQuery.data.history.length > 0 && (
            <ul className="flex flex-col gap-2">
              {historyQuery.data.history.map((entry) => (
                <li key={entry.id}>
                  <Text size="small">
                    {entry.action} · {entry.actor} · {new Date(entry.createdAt).toLocaleString()}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </Container>
      )}

      <Container className="flex flex-col gap-2 p-6">
        <Text size="small" weight="plus">Rejection reason (optional, applies to the next single reject)</Text>
        <Textarea
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value.slice(0, 2000))}
          placeholder="Why is this proposal being rejected?"
          maxLength={2000}
        />
      </Container>

      {createCardRow && (
        <CreateCardDialog
          row={createCardRow}
          onClose={() => setCreateCardRow(null)}
          onCreated={refreshAfterAction}
        />
      )}

      {alternativeMatchEntryId && (
        <AlternativeMatchDialog
          key={alternativeMatchEntryId}
          snapshotId={snapshotId}
          entryId={alternativeMatchEntryId}
          onClose={() => setAlternativeMatchEntryId(null)}
          onMatched={refreshAfterAction}
        />
      )}

      {editIllustratorCardId && (
        <EditIllustratorDialog
          key={editIllustratorCardId}
          tradingCardId={editIllustratorCardId}
          onClose={() => setEditIllustratorCardId(null)}
          onSaved={refreshAfterAction}
        />
      )}

      {manageGroupProposalId && (
        <ManageGroupDialog
          key={manageGroupProposalId}
          proposalId={manageGroupProposalId}
          onClose={() => setManageGroupProposalId(null)}
          onChanged={refreshAfterAction}
        />
      )}

      {categoryProposalId && (
        <CategoryAssignmentDialog
          key={categoryProposalId}
          proposalId={categoryProposalId}
          onClose={() => setCategoryProposalId(null)}
          onConfirmed={refreshAfterAction}
          showNext={Boolean(nextCategoryProposalId)}
          onNext={nextCategoryProposalId ? () => setCategoryProposalId(nextCategoryProposalId) : undefined}
        />
      )}

      {selectedProposal && selectedEntryQuery.data?.entries[0] && (() => {
        const entry = selectedEntryQuery.data.entries[0]
        const selectedIndex = visibleRows.findIndex((row) => row.id === selectedProposal.id)
        const thumbnail = entry.tradingCardVariantId
          ? thumbnailsQuery.data?.thumbnails[entry.tradingCardVariantId]
          : undefined
        return (
          <EntryDetailDrawer
            snapshotId={snapshotId}
            row={entry}
            thumbnail={thumbnail}
            onClose={() => setSelectedProposal(null)}
            onPrevious={selectedIndex > 0 ? () => setSelectedProposal(visibleRows[selectedIndex - 1]) : undefined}
            onNext={selectedIndex >= 0 && selectedIndex < visibleRows.length - 1
              ? () => setSelectedProposal(visibleRows[selectedIndex + 1])
              : undefined}
            onFindAlternativeMatch={() => setAlternativeMatchEntryId(entry.id)}
            onEditIllustrator={entry.card?.tradingCardId ? () => setEditIllustratorCardId(entry.card!.tradingCardId) : undefined}
          />
        )
      })()}
    </div>
  )
}

export default InventoryProposalsPage
