import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { fetchJson } from "../../../components/imports/fetch-json"
import ImportStepper from "../../../components/imports/import-stepper"
import PaginationBar from "../../../components/imports/pagination-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../components/imports/review-table"
import type { InventorySnapshotListItem, InventorySnapshotListResponse } from "../../../components/imports/pulse-import-types"
import "../../../styles/imports.css"

const PAGE_SIZE = 20

const STATUS_COLOR: Record<string, "grey" | "orange" | "red" | "green" | "blue"> = {
  DRAFT: "grey", VALIDATED: "grey", PENDING_REVIEW: "orange", APPROVED: "blue",
  APPLYING: "orange", APPLIED: "green", REJECTED: "red", FAILED: "red", SUPERSEDED: "grey",
}

/** Minimal, navigation-only list — supports finding a snapshot's proposal review page. */
const ImportsSnapshotListPage = () => {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: ["inventory-snapshots", offset],
    queryFn: () => fetchJson<InventorySnapshotListResponse>(
      `/admin/trading-card-inventory/imports/snapshots?limit=${PAGE_SIZE}&offset=${offset}`
    ),
    placeholderData: keepPreviousData,
  })

  const columns: ReviewTableColumn<InventorySnapshotListItem>[] = [
    { header: "File", cell: (row) => row.originalFilename ?? "—" },
    { header: "Sequence", cell: (row) => row.sequenceNumber },
    { header: "Rows", cell: (row) => row.rowCount ?? "—" },
    { header: "Status", cell: (row) => <Badge size="2xsmall" color={STATUS_COLOR[row.status] ?? "grey"}>{row.status}</Badge> },
    { header: "Created", cell: (row) => new Date(row.createdAt).toLocaleString() },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Your imports</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          Each row below is one uploaded file, called a "snapshot". Click one to check the rows
          matched against your catalogue and TCGdex, then continue: review the changes it
          suggests, then apply the ones you approve.
        </Text>
        <Text size="small">
          <Link to="/imports">Back to imports</Link>
        </Text>
      </Container>

      <Container className="divide-y p-0">
        <ReviewTable
          columns={columns}
          rows={query.data?.snapshots ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/imports/snapshots/${encodeURIComponent(row.id)}`)}
          isLoading={query.isLoading}
          isError={query.isError}
          emptyMessage="No snapshots yet. Upload a CSV to get started."
        />
        {query.data && (
          <PaginationBar offset={offset} limit={query.data.limit} count={query.data.count} onOffsetChange={setOffset} />
        )}
      </Container>
    </div>
  )
}

export default ImportsSnapshotListPage
