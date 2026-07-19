import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router-dom"
import { fetchJson, postAction } from "../../../components/imports/fetch-json"
import PaginationBar from "../../../components/imports/pagination-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../components/imports/review-table"
import type { InventorySourceListItem, InventorySourceListResponse } from "../../../components/imports/pulse-import-types"
import "../../../styles/imports.css"

const PAGE_SIZE = 20

const sourcesQueryKey = (statusFilter: string, offset: number) => ["inventory-sources-admin", { statusFilter, offset }]

const InventorySourcesPage = () => {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState("")
  const [offset, setOffset] = useState(0)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const query = useQuery({
    queryKey: sourcesQueryKey(statusFilter, offset),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (statusFilter) params.set("status", statusFilter)
      return fetchJson<InventorySourceListResponse>(`/admin/trading-card-inventory/sources?${params.toString()}`)
    },
    placeholderData: keepPreviousData,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["inventory-sources-admin"] })

  const renameMutation = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      postAction(`/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/rename`, { displayName }),
    onSuccess: () => {
      toast.success("Source renamed")
      setRenamingId(null)
      refresh()
    },
    onError: () => toast.error("This source could not be renamed. Please try again."),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => postAction(`/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/archive`),
    onSuccess: () => {
      toast.success("Source removed")
      refresh()
    },
    onError: () => toast.error("This source could not be removed. Please try again."),
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => postAction(`/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/restore`),
    onSuccess: () => {
      toast.success("Source restored")
      refresh()
    },
    onError: () => toast.error("This source could not be restored. Please try again."),
  })

  const startRename = (source: InventorySourceListItem) => {
    setRenamingId(source.id)
    setRenameValue(source.displayName)
  }

  const columns: ReviewTableColumn<InventorySourceListItem>[] = [
    {
      header: "Name",
      cell: (row) =>
        renamingId === row.id ? (
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <Input
              size="small"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              aria-label="New source name"
            />
            <Button
              size="small"
              variant="primary"
              isLoading={renameMutation.isPending}
              disabled={!renameValue.trim()}
              onClick={() => renameMutation.mutate({ id: row.id, displayName: renameValue.trim() })}
            >
              Save
            </Button>
            <Button size="small" variant="secondary" onClick={() => setRenamingId(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Text size="small">{row.displayName}</Text>
        ),
    },
    { header: "Provider", cell: (row) => row.provider },
    { header: "Language", cell: (row) => row.language ?? "—" },
    { header: "Currency", cell: (row) => row.defaultCurrencyCode ?? "—" },
    {
      header: "Status",
      cell: (row) => (
        <Badge size="2xsmall" color={row.status === "ACTIVE" ? "green" : "grey"}>
          {row.status === "ACTIVE" ? "Active" : "Removed"}
        </Badge>
      ),
    },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {renamingId !== row.id && (
            <Button size="small" variant="secondary" onClick={() => startRename(row)}>
              Rename
            </Button>
          )}
          {row.status === "ACTIVE" && (
            <Button size="small" variant="danger" isLoading={archiveMutation.isPending} onClick={() => archiveMutation.mutate(row.id)}>
              Remove
            </Button>
          )}
          {row.status === "ARCHIVED" && (
            <Button size="small" variant="secondary" isLoading={restoreMutation.isPending} onClick={() => restoreMutation.mutate(row.id)}>
              Restore
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Inventory sources</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          A source is where an import file comes from (for example an eBay stock export). Removing
          a source hides it from the upload screen but keeps its history — you can restore it later.
          Renaming only changes the display name, nothing else.
        </Text>
        <Text size="small">
          <Link to="/imports/new">Back to upload</Link>
        </Text>
      </Container>

      <Container className="flex flex-col gap-3 p-0">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Heading level="h2">Sources</Heading>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => { setStatusFilter(event.target.value); setOffset(0) }}
            className="rounded-none border p-1 text-sm"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Removed</option>
          </select>
        </div>
        <ReviewTable
          columns={columns}
          rows={query.data?.sources ?? []}
          rowKey={(row) => row.id}
          isLoading={query.isLoading}
          isError={query.isError}
          emptyMessage="No inventory sources match this filter."
        />
        {query.data && (
          <PaginationBar
            offset={offset}
            limit={query.data.limit}
            count={query.data.count}
            onOffsetChange={setOffset}
          />
        )}
      </Container>
    </div>
  )
}

export default InventorySourcesPage
