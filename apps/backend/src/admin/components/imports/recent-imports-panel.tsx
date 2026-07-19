import { Badge, Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { fetchJson, postAction } from "./fetch-json"
import { formatEnumLabel } from "./format-enum-label"
import ReviewTable, { type ReviewTableColumn } from "./review-table"
import type { InventorySnapshotListItem, InventorySnapshotListResponse } from "./pulse-import-types"

const RECENT_IMPORTS_LIMIT = 50

const STATUS_COLOR: Record<string, "grey" | "orange" | "red" | "green" | "blue"> = {
  DRAFT: "grey", VALIDATED: "grey", PENDING_REVIEW: "orange", APPROVED: "blue",
  APPLYING: "orange", APPLIED: "green", REJECTED: "red", FAILED: "red", SUPERSEDED: "grey",
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", VALIDATED: "Validated", PENDING_REVIEW: "Pending review", APPROVED: "Approved",
  APPLYING: "Applying", APPLIED: "Applied", REJECTED: "Rejected", FAILED: "Failed", SUPERSEDED: "Superseded",
  DISCARDED: "Discarded",
}

/** Statuses that have not reached a terminal outcome yet — shown under "Pending". */
const PENDING_STATUSES = new Set(["DRAFT", "VALIDATED", "PENDING_REVIEW", "APPROVED", "APPLYING"])

/**
 * Statuses safe to discard: nothing here has touched real stock yet, or the
 * import already failed/was rejected. APPLIED/APPLYING are never in this
 * set — the backend's transition table would reject the request anyway, but
 * hiding the button here avoids offering an action that can't succeed.
 */
const DISCARDABLE_STATUSES = new Set(["DRAFT", "VALIDATED", "PENDING_REVIEW", "APPROVED", "REJECTED", "FAILED"])

export const recentImportsQueryKey = ["recent-inventory-snapshots"]

interface RecentImportsPanelProps {
  /** Caps how many rows render per group. The overview page keeps this small; a future full list page can raise it. */
  maxRowsPerGroup?: number
}

const RecentImportsPanel = ({ maxRowsPerGroup = 10 }: RecentImportsPanelProps) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const prompt = usePrompt()

  const query = useQuery({
    queryKey: recentImportsQueryKey,
    queryFn: () => fetchJson<InventorySnapshotListResponse>(
      `/admin/trading-card-inventory/imports/snapshots?limit=${RECENT_IMPORTS_LIMIT}&offset=0`,
    ),
  })

  const handleDiscard = async (row: InventorySnapshotListItem) => {
    const confirmed = await prompt({
      title: "Delete this import?",
      description: row.originalFilename
        ? `"${row.originalFilename}" will be removed from this list. This cannot be undone from here, and is only possible because nothing from it has been applied to stock yet.`
        : "This import will be removed from this list. This cannot be undone from here, and is only possible because nothing from it has been applied to stock yet.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    })
    if (!confirmed) return
    try {
      await postAction(`/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(row.id)}/discard`)
      toast.success("Import deleted")
      queryClient.invalidateQueries({ queryKey: recentImportsQueryKey })
    } catch {
      toast.error("This import could not be deleted. Please try again.")
    }
  }

  const allRows = (query.data?.snapshots ?? []).filter((row) => row.status !== "DISCARDED")
  const pendingRows = allRows.filter((row) => PENDING_STATUSES.has(row.status)).slice(0, maxRowsPerGroup)
  const completeRows = allRows.filter((row) => !PENDING_STATUSES.has(row.status)).slice(0, maxRowsPerGroup)

  const columns = (group: "PENDING" | "COMPLETE"): ReviewTableColumn<InventorySnapshotListItem>[] => [
    { header: "File", cell: (row) => row.originalFilename ?? "—" },
    { header: "Rows", cell: (row) => row.rowCount ?? "—" },
    { header: "Status", cell: (row) => <Badge size="2xsmall" color={STATUS_COLOR[row.status] ?? "grey"}>{STATUS_LABEL[row.status] ?? formatEnumLabel(row.status)}</Badge> },
    { header: "Created", cell: (row) => new Date(row.createdAt).toLocaleString() },
    {
      header: "",
      cell: (row) => (
        group === "PENDING" || DISCARDABLE_STATUSES.has(row.status) ? (
          <Button
            size="small"
            variant="danger"
            disabled={!DISCARDABLE_STATUSES.has(row.status)}
            onClick={(event) => {
              event.stopPropagation()
              void handleDiscard(row)
            }}
          >
            Delete
          </Button>
        ) : null
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Container className="flex flex-col gap-3 p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <Heading level="h2">Pending</Heading>
        </div>
        <ReviewTable
          columns={columns("PENDING")}
          rows={pendingRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/imports/snapshots/${encodeURIComponent(row.id)}`)}
          isLoading={query.isLoading}
          isError={query.isError}
          emptyMessage="No imports waiting on review right now."
        />
      </Container>

      <Container className="flex flex-col gap-3 p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <Heading level="h2">Complete</Heading>
        </div>
        <ReviewTable
          columns={columns("COMPLETE")}
          rows={completeRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/imports/snapshots/${encodeURIComponent(row.id)}`)}
          isLoading={query.isLoading}
          isError={query.isError}
          emptyMessage="No completed imports yet."
        />
      </Container>

      {allRows.length > 0 && (
        <Text size="xsmall" className="text-ui-fg-muted">
          Showing the {RECENT_IMPORTS_LIMIT} most recent imports.
        </Text>
      )}
    </div>
  )
}

export default RecentImportsPanel
