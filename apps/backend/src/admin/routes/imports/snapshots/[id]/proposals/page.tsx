import { Badge, Button, Container, Heading, Text, Textarea, toast, usePrompt } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, type MouseEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import CategoryAssignmentDialog from "../../../../../components/imports/category-assignment-dialog"
import CreateCardDialog from "../../../../../components/imports/create-card-dialog"
import CardImageThumbnail from "../../../../../components/imports/card-image-thumbnail"
import AlternativeMatchDialog from "../../../../../components/imports/alternative-match-dialog"
import BadgeWithTooltip from "../../../../../components/imports/badge-with-tooltip"
import EditIllustratorDialog from "../../../../../components/imports/edit-illustrator-dialog"
import EntryDetailDrawer from "../../../../../components/imports/entry-detail-drawer"
import FailedLookupsPanel from "../../../../../components/imports/failed-lookups-panel"
import ManageGroupDialog from "../../../../../components/imports/manage-group-dialog"
import { fetchJson, postAction } from "../../../../../components/imports/fetch-json"
import ImportStepper from "../../../../../components/imports/import-stepper"
import PaginationBar from "../../../../../components/imports/pagination-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../../../components/imports/review-table"
import SelectAllCheckbox from "../../../../../components/imports/select-all-checkbox"
import { useRangeSelection } from "../../../../../components/imports/use-range-selection"
import { formatEnumLabel } from "../../../../../components/imports/format-enum-label"
import { categoryPathLabel } from "../../../../../components/ebay/category-tree"
import type { StoreCategoryLike } from "../../../../../components/ebay/category-tree"
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

  // Moved from a separate "History"/"Hide history" row control into the
  // drawer itself — one less click, and it sits alongside the rest of this
  // row's detail instead of a separate expanding panel below the table.
  const historyQuery = useQuery({
    queryKey: ["inventory-proposal-detail", selectedProposal?.id],
    queryFn: () => fetchJson<InventoryProposalDetailResponse>(`/admin/trading-card-inventory/proposals/${encodeURIComponent(selectedProposal!.id)}`),
    enabled: Boolean(selectedProposal?.id),
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

  const EBAY_CATEGORY_SYNC_BATCH_SIZE = 20
  const [ebayCategorySyncProgress, setEbayCategorySyncProgress] = useState<{ done: number; total: number } | null>(null)
  interface SyncEbayCategoriesBatchResponse {
    recomputedCount: number; totalEligibleCount: number; remainingCount: number; nextCursor: string | null
    ruleMatchCount: number; fallbackCount: number; noMatchCount: number
  }
  const syncEbayCategoriesMutation = useMutation({
    mutationFn: async () => {
      // Chunked and resumable: every batch permanently persists its own
      // results, so an accidental page refresh mid-sync loses nothing —
      // clicking the button again just restarts from the beginning and
      // safely re-processes (a fresh RULE_MATCH is already excluded from the
      // next query once confirmed; anything else is harmless to recompute).
      //
      // The eligible set is recomputed on every request, and a FALLBACK or
      // NO_MATCH row never leaves it (only a fresh RULE_MATCH auto-confirms
      // and drops out), so we page by an id cursor rather than a numeric
      // offset — a numeric offset would either loop forever reprocessing the
      // same stuck rows or skip past ones that legitimately remain eligible.
      let done = 0
      let afterId: string | undefined
      let totals = { ruleMatchCount: 0, fallbackCount: 0, noMatchCount: 0, recomputedCount: 0 }
      let totalEligibleCount = 0
      for (;;) {
        const batch = await postAction<SyncEbayCategoriesBatchResponse>(
          `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/sync-ebay-categories`,
          { limit: EBAY_CATEGORY_SYNC_BATCH_SIZE, afterId },
        )
        totalEligibleCount = batch.totalEligibleCount
        totals = {
          ruleMatchCount: totals.ruleMatchCount + batch.ruleMatchCount,
          fallbackCount: totals.fallbackCount + batch.fallbackCount,
          noMatchCount: totals.noMatchCount + batch.noMatchCount,
          recomputedCount: totals.recomputedCount + batch.recomputedCount,
        }
        done += batch.recomputedCount
        afterId = batch.nextCursor ?? afterId
        setEbayCategorySyncProgress({ done, total: totalEligibleCount })
        if (batch.remainingCount <= 0 || batch.recomputedCount === 0) break
      }
      return totals
    },
    onSuccess: (result) => {
      if (result.recomputedCount === 0) {
        toast.success("Nothing needed a category sync — every proposal already has one.")
      } else {
        const parts = [`${result.ruleMatchCount} auto-confirmed by rule`]
        if (result.fallbackCount > 0) parts.push(`${result.fallbackCount} fell back (needs confirmation)`)
        if (result.noMatchCount > 0) parts.push(`${result.noMatchCount} still need a category`)
        toast.success(`Synced ${result.recomputedCount} proposal${result.recomputedCount === 1 ? "" : "s"}: ${parts.join(", ")}.`)
      }
      refreshAfterAction()
    },
    onError: (error: Error) => toast.error(error.message || "eBay categories could not be synced. Please try again."),
    onSettled: () => setEbayCategorySyncProgress(null),
  })

  const PUBLISH_BATCH_SIZE = 20
  const [publishProgress, setPublishProgress] = useState<{ done: number; total: number } | null>(null)
  interface PublishBatchResponse {
    processedCount: number; totalEligibleCount: number; remainingCount: number; nextCursor: string | null
    approvedCount: number; appliedCount: number; skippedCount: number; errors: string[]
  }
  const publishMutation = useMutation({
    mutationFn: async (ids?: string[]) => {
      // Chunked and resumable, same reasoning as the eBay category sync: an
      // accidental refresh mid-publish loses nothing — every batch's
      // approve/apply calls are already durably committed. The eligible set
      // is recomputed on every request, and a proposal that ends up skipped
      // (still needs "Create card", still needs its eBay category, or
      // errors) never leaves it, so we page by an id cursor rather than a
      // numeric offset — a numeric offset would either loop forever
      // reprocessing the same stuck rows or skip past ones that legitimately
      // remain eligible.
      let done = 0
      let afterId: string | undefined
      let totals = { approvedCount: 0, appliedCount: 0, skippedCount: 0, errors: [] as string[] }
      let totalEligibleCount = 0
      for (;;) {
        const batch = await postAction<PublishBatchResponse>(
          `/admin/trading-card-inventory/proposals/publish`,
          { snapshotId, ids, limit: PUBLISH_BATCH_SIZE, afterId },
        )
        totalEligibleCount = batch.totalEligibleCount
        totals = {
          approvedCount: totals.approvedCount + batch.approvedCount,
          appliedCount: totals.appliedCount + batch.appliedCount,
          skippedCount: totals.skippedCount + batch.skippedCount,
          errors: [...totals.errors, ...batch.errors],
        }
        done += batch.processedCount
        afterId = batch.nextCursor ?? afterId
        setPublishProgress({ done, total: totalEligibleCount })
        if (batch.remainingCount <= 0 || batch.processedCount === 0) break
      }
      return { ...totals, totalEligibleCount }
    },
    onSuccess: (result) => {
      if (result.totalEligibleCount === 0) {
        toast.success("Nothing was ready to publish — approve or create cards for the remaining rows first.")
      } else {
        const parts = [`${result.appliedCount} applied`]
        if (result.approvedCount > 0) parts.push(`${result.approvedCount} approved`)
        if (result.skippedCount > 0) parts.push(`${result.skippedCount} skipped`)
        const summary = `Published ${result.totalEligibleCount} proposal${result.totalEligibleCount === 1 ? "" : "s"}: ${parts.join(", ")}.`
        if (result.errors.length > 0) toast.error(summary, { description: result.errors.join(" | ") })
        else toast.success(summary)
      }
      refreshAfterAction()
    },
    onError: (error: Error) => toast.error(error.message || "Publishing could not be completed. Please try again."),
    onSettled: () => setPublishProgress(null),
  })

  // Resolves an eBay Store category id to its full "Main - Sub - Third"
  // breadcrumb for the "Synced"/"Needs confirmation" badge tooltip and the
  // drawer's eBay category section — merges both environments since a
  // category id from either could show up here and this is read-only
  // display, not editing. Breadcrumb is walked live via `categoryPathLabel`
  // rather than trusted from the stored `path` column, which can go stale if
  // a category is ever reparented after creation.
  const ebayCategoriesQuery = useQuery({
    queryKey: ["ebay-store-categories-all-environments"],
    queryFn: async () => {
      const [sandbox, production] = await Promise.allSettled([
        fetchJson<{ categories: StoreCategoryLike[] }>(`/admin/ebay/store-categories?environment=SANDBOX`),
        fetchJson<{ categories: StoreCategoryLike[] }>(`/admin/ebay/store-categories?environment=PRODUCTION`),
      ])
      const categories: StoreCategoryLike[] = []
      for (const outcome of [sandbox, production]) {
        if (outcome.status === "fulfilled") categories.push(...outcome.value.categories)
      }
      return categories
    },
  })
  const ebayCategoryName = (id: string | null) => (id ? categoryPathLabel(ebayCategoriesQuery.data ?? [], id) ?? id : null)

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

  // Client-side sort over the current page only — Card/Set/eBay category
  // values are resolved after the fetch (attachCardIdentities, the category
  // catalogue lookup), so there's no single DB column to `ORDER BY` for them
  // without a much larger backend change. Fine at this page size (20 rows).
  const EBAY_CATEGORY_SORT_RANK: Record<string, number> = { CONFIRMED: 2, PROPOSED: 1, NONE: 0 }
  const ebayCategorySortRank = (row: InventoryProposalListItem) => {
    if (row.changeKind !== "NEW_HOLDING") return -1
    if (row.confirmedEbayStoreCategoryId) return EBAY_CATEGORY_SORT_RANK.CONFIRMED
    if (row.proposedEbayStoreCategoryId) return EBAY_CATEGORY_SORT_RANK.PROPOSED
    return EBAY_CATEGORY_SORT_RANK.NONE
  }
  type ProposalSortKey = "uploadedImage" | "card" | "set" | "rarity" | "changeKind" | "quantity" | "ebayCategory"
  const [proposalSort, setProposalSort] = useState<{ key: ProposalSortKey; direction: "asc" | "desc" } | null>(null)
  const proposalSortValue = (row: InventoryProposalListItem, key: ProposalSortKey): string | number => {
    switch (key) {
      case "uploadedImage": return row.tradingCardVariantId && thumbnailsQuery.data?.thumbnails[row.tradingCardVariantId]?.photoUrl ? 1 : 0
      case "card": return (row.card?.name ?? row.cardIdentityHint ?? "").toLowerCase()
      case "set": return (row.card?.setDisplayName ?? "").toLowerCase()
      case "rarity": return (row.card?.rarity ?? row.card?.rarityRaw ?? "").toLowerCase()
      case "changeKind": return CHANGE_KIND_LABEL[row.changeKind] ?? row.changeKind
      case "quantity": return row.proposedQuantity ?? 0
      case "ebayCategory": return ebayCategorySortRank(row)
    }
  }
  const sortableHeader = (label: string, key: ProposalSortKey) => {
    const active = proposalSort?.key === key
    const arrow = active ? (proposalSort!.direction === "asc" ? "↑" : "↓") : "↕"
    return (
      <button
        type="button"
        className="flex items-center gap-1 whitespace-nowrap"
        aria-label={`Sort by ${label}`}
        onClick={() => setProposalSort((current) => ({
          key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
        }))}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={active ? "text-ui-fg-base" : "text-ui-fg-muted"}>{arrow}</span>
      </button>
    )
  }

  const unsortedRows = proposalsQuery.data?.proposals ?? []
  const visibleRows = proposalSort
    ? [...unsortedRows].sort((a, b) => {
        const va = proposalSortValue(a, proposalSort.key)
        const vb = proposalSortValue(b, proposalSort.key)
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))
        return proposalSort.direction === "asc" ? cmp : -cmp
      })
    : unsortedRows
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
      headerCell: sortableHeader("Card", "uploadedImage"),
      headerClassName: "max-w-16",
      cell: (row) => {
        const image = row.tradingCardVariantId ? thumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        return <CardImageThumbnail imageUrl={image?.photoUrl ?? null} alt={`Uploaded image for ${row.card?.name ?? row.cardIdentityHint ?? "unmatched card"}`} />
      },
    },
    {
      header: "Card name",
      headerCell: sortableHeader("Card name", "card"),
      cell: (row) => {
        if (row.card) {
          return (
            <div className="flex flex-col">
              <Text size="small" weight="plus">{row.card.name}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Card {row.card.cardNumber} · {formatEnumLabel(row.card.condition)} · {formatEnumLabel(row.card.finish)}
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
    { header: "Set", headerCell: sortableHeader("Set", "set"), cell: (row) => row.card?.setDisplayName ?? "—" },
    {
      header: "Rarity",
      headerCell: sortableHeader("Rarity", "rarity"),
      cell: (row) => row.card?.rarity ? formatEnumLabel(row.card.rarity) : (row.card?.rarityRaw ?? "—"),
    },
    { header: "Change", headerCell: sortableHeader("Change", "changeKind"), cell: (row) => CHANGE_KIND_LABEL[row.changeKind] ?? formatEnumLabel(row.changeKind) },
    {
      header: "Quantity",
      headerCell: sortableHeader("Quantity", "quantity"),
      cell: (row) => {
        const previous = row.previousQuantity ?? 0
        const proposed = row.proposedQuantity ?? 0
        const color = proposed > previous ? "green" : proposed < previous ? "red" : "grey"
        return <Badge size="2xsmall" color={color}>{previous} → {proposed}</Badge>
      },
    },
    {
      header: "eBay category",
      headerCell: sortableHeader("eBay category", "ebayCategory"),
      cell: (row) => {
        if (row.changeKind !== "NEW_HOLDING") return <Text size="small" className="text-ui-fg-subtle">—</Text>
        if (row.confirmedEbayStoreCategoryId) {
          const categoryLabel = ebayCategoryName(row.confirmedEbayStoreCategoryId) ?? "Synced"
          const tooltip = row.categoryConfirmedBy === "system:category-rule-auto-confirm"
            ? `${categoryLabel} (auto-synced by rule)`
            : categoryLabel
          return (
            <BadgeWithTooltip color="green" tooltip={tooltip}>
              Synced
            </BadgeWithTooltip>
          )
        }
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate(`/imports/images?snapshotId=${encodeURIComponent(snapshotId)}`)}>
            Back: Assign card images
          </Button>
          <Button isLoading={publishMutation.isPending} onClick={() => publishMutation.mutate(undefined)}>
            Publish all
          </Button>
        </div>
        {publishProgress && (
          <>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Publishing {publishProgress.done} of {publishProgress.total}…
            </Text>
            <div
              className="h-2 w-full bg-ui-bg-subtle"
              role="progressbar"
              aria-valuenow={publishProgress.total > 0 ? Math.round((publishProgress.done / publishProgress.total) * 100) : 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Publishing: ${publishProgress.done} of ${publishProgress.total} done`}
            >
              <div
                className="h-2 bg-ui-fg-interactive transition-[width]"
                style={{ width: `${publishProgress.total > 0 ? Math.round((publishProgress.done / publishProgress.total) * 100) : 0}%` }}
              />
            </div>
          </>
        )}
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
          {progress.fullyComplete && <Badge size="2xsmall" color="green">Import status: Complete</Badge>}
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
          <div className="flex flex-wrap items-center gap-2">
            {selection.selected.size > 0 && (
              <>
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
                <Button
                  size="small"
                  variant="primary"
                  isLoading={publishMutation.isPending}
                  onClick={() => publishMutation.mutate([...selection.selected])}
                >
                  Publish selected
                </Button>
              </>
            )}
            <Button
              size="small"
              variant="secondary"
              isLoading={syncEbayCategoriesMutation.isPending}
              onClick={() => syncEbayCategoriesMutation.mutate()}
            >
              Sync eBay categories
            </Button>
          </div>
        </div>
        {ebayCategorySyncProgress && (
          <>
            <Text size="xsmall" className="px-4 text-ui-fg-subtle">
              Syncing {ebayCategorySyncProgress.done} of {ebayCategorySyncProgress.total}…
            </Text>
            <div
              className="h-2 w-full bg-ui-bg-subtle"
              role="progressbar"
              aria-valuenow={ebayCategorySyncProgress.total > 0 ? Math.round((ebayCategorySyncProgress.done / ebayCategorySyncProgress.total) * 100) : 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Syncing eBay categories: ${ebayCategorySyncProgress.done} of ${ebayCategorySyncProgress.total} done`}
            >
              <div
                className="h-2 bg-ui-fg-interactive transition-[width]"
                style={{ width: `${ebayCategorySyncProgress.total > 0 ? Math.round((ebayCategorySyncProgress.done / ebayCategorySyncProgress.total) * 100) : 0}%` }}
              />
            </div>
          </>
        )}

        <ReviewTable
          columns={columns}
          rows={visibleRows}
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
            proposal={selectedProposal}
            ebayCategoryName={ebayCategoryName}
            onCategoryConfirmed={refreshAfterAction}
            history={historyQuery.data?.history}
            historyLoading={historyQuery.isLoading}
          />
        )
      })()}
    </div>
  )
}

export default InventoryProposalsPage
