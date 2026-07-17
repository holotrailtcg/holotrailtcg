import { Badge, Button, Container, Heading, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchJson, postAction } from "../../../../../components/imports/fetch-json"
import ImportStepper from "../../../../../components/imports/import-stepper"
import InventoryProposalStatusBadge from "../../../../../components/imports/inventory-proposal-status-badge"
import PaginationBar from "../../../../../components/imports/pagination-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../../../components/imports/review-table"
import type {
  ApplyProposalItemResult, InventoryProposalDetailResponse, InventoryProposalListItem, InventoryProposalListResponse,
  SnapshotProgress,
} from "../../../../../components/imports/pulse-import-types"
import "../../../../../styles/imports.css"

const PAGE_SIZE = 20
const APPLICABLE_CHANGE_KINDS = new Set(["NEW_HOLDING", "QUANTITY_CHANGE"])

function selectionKind(row: InventoryProposalListItem): "REVIEW" | "APPLY" | null {
  if (row.reviewStatus === "PENDING") return "REVIEW"
  if (row.reviewStatus === "APPROVED" && row.tradingCardVariantId && row.proposedQuantity !== null &&
    APPLICABLE_CHANGE_KINDS.has(row.changeKind)) return "APPLY"
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
  const prompt = usePrompt()

  const [offset, setOffset] = useState(0)
  const [reviewStatusFilter, setReviewStatusFilter] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const summaryQuery = useQuery({
    queryKey: summaryQueryKey(snapshotId),
    queryFn: () => fetchJson<{ summary: { inventorySourceId: string }; progress: SnapshotProgress }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`
    ),
    enabled: Boolean(snapshotId),
  })

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
    setSelected(new Set())
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

  const toggleSelected = (row: InventoryProposalListItem) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(row.id)) {
        next.delete(row.id)
      } else {
        const rows = proposalsQuery.data?.proposals ?? []
        const kind = selectionKind(row)
        for (const selectedId of next) {
          const selectedRow = rows.find((candidate) => candidate.id === selectedId)
          if (!selectedRow || selectionKind(selectedRow) !== kind) next.delete(selectedId)
        }
        next.add(row.id)
      }
      return next
    })
  }

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
    const ids = [...selected]
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
    const ids = [...selected]
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
  const selectedRows = visibleRows.filter((row) => selected.has(row.id))
  const selectedKind = selectedRows.length > 0 ? selectionKind(selectedRows[0]) : null

  const columns: ReviewTableColumn<InventoryProposalListItem>[] = [
    {
      header: "",
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`Select proposal ${row.id}`}
          checked={selected.has(row.id)}
          disabled={selectionKind(row) === null}
          onChange={() => toggleSelected(row)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
    },
    { header: "Variant", cell: (row) => row.tradingCardVariantId ?? "Unresolved" },
    { header: "Change", cell: (row) => row.changeKind },
    { header: "Quantity", cell: (row) => `${row.previousQuantity ?? 0} → ${row.proposedQuantity ?? 0}` },
    { header: "Status", cell: (row) => <InventoryProposalStatusBadge reviewStatus={row.reviewStatus} medusaSyncStatus={row.medusaSyncStatus} /> },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {row.reviewStatus === "PENDING" && (
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
          {row.reviewStatus === "APPLIED" && row.medusaSyncStatus === "FAILED" && (
            <Button size="small" variant="secondary" isLoading={retrySyncMutation.isPending} onClick={() => retrySyncMutation.mutate(row.id)}>
              Retry sync
            </Button>
          )}
          <Button size="small" variant="transparent" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
            {expandedId === row.id ? "Hide history" : "History"}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Review inventory proposals</Heading>
        <ImportStepper compact />
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
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Text size="small" className="text-ui-fg-subtle">{selected.size} selected</Text>
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
    </div>
  )
}

export default InventoryProposalsPage
