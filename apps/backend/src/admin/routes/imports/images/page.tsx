import { Button, Container, Heading, Text } from "@medusajs/ui"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { fetchJson } from "../../../components/imports/fetch-json"
import ImportStepper from "../../../components/imports/import-stepper"
import ImageNeedStatusBadge from "../../../components/imports/image-need-status-badge"
import type { ImageListItem, ImageListResponse } from "../../../components/imports/image-types"
import type { InventoryProposalListResponse } from "../../../components/imports/pulse-import-types"
import PaginationBar from "../../../components/imports/pagination-bar"
import ReviewSearchFilterBar from "../../../components/imports/review-search-filter-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../components/imports/review-table"
import "../../../styles/imports.css"

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: "MISSING", label: "No images yet" },
  { value: "PARTIAL", label: "Some images missing" },
  { value: "READY", label: "All variants have images" },
]

const LANGUAGE_OPTIONS = [
  { value: "EN", label: "English" },
  { value: "JA", label: "Japanese" },
  { value: "ZH", label: "Chinese" },
]

const ImportsImagesPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const snapshotId = searchParams.get("snapshotId") ?? ""
  const [scopedToSnapshot, setScopedToSnapshot] = useState(Boolean(snapshotId))
  const [search, setSearch] = useState("")
  const [language, setLanguage] = useState("")
  const [status, setStatus] = useState("")
  const [offset, setOffset] = useState(0)

  const isScoped = scopedToSnapshot && Boolean(snapshotId)

  // Reached via "Next" from step 2/4 with `?snapshotId=`, this narrows the
  // otherwise catalogue-wide list down to just the cards from that import,
  // so finishing an import feels like one continuous job.
  const snapshotCardsQuery = useQuery({
    queryKey: ["images-snapshot-cards", snapshotId],
    queryFn: () => fetchJson<InventoryProposalListResponse>(
      `/admin/trading-card-inventory/proposals?limit=100&offset=0&inventorySnapshotId=${encodeURIComponent(snapshotId)}`,
    ),
    enabled: isScoped,
  })
  const scopedTradingCardIds = [...new Set(
    (snapshotCardsQuery.data?.proposals ?? [])
      .map((proposal) => proposal.card?.tradingCardId)
      .filter((id): id is string => Boolean(id)),
  )]
  const scopeReady = !isScoped || snapshotCardsQuery.isSuccess
  const scopedWithNoCards = isScoped && scopeReady && scopedTradingCardIds.length === 0

  const query = useQuery({
    queryKey: ["images-needing", { search, language, status, offset, isScoped, scopedTradingCardIds }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (search.trim()) params.set("q", search.trim())
      if (language) params.set("language", language)
      if (status) params.set("status", status)
      if (isScoped) params.set("tradingCardIds", scopedTradingCardIds.join(","))
      return fetchJson<ImageListResponse>(`/admin/trading-cards/needing-images?${params.toString()}`)
    },
    enabled: scopeReady && !scopedWithNoCards,
    placeholderData: keepPreviousData,
  })

  const columns: ReviewTableColumn<ImageListItem>[] = [
    { header: "Card", cell: (row) => row.card_name },
    { header: "Set", cell: (row) => row.card_set.display_name },
    { header: "Number", cell: (row) => row.card_number },
    { header: "Language", cell: (row) => row.card_set.language },
    {
      header: "Variant details",
      cell: (row) => `${row.total_variant_count} variants, ${row.variants_missing_images} missing`,
    },
    { header: "Ready images", cell: (row) => row.ready_image_count },
    { header: "Status", cell: (row) => <ImageNeedStatusBadge status={row.need_status} /> },
  ]

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Assign card images</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          This list shows every card that still needs a real photograph. Click a card, then upload
          a photo for each of its versions (for example, Near Mint and Holo are separate
          versions and each need their own photo). This page works on its own — you do not need to
          come here as part of an import, and you can add photos to a card at any time.
        </Text>
        <Text size="small">
          <Link to="/imports">Back to imports</Link>
        </Text>
      </Container>

      {isScoped && (
        <Container className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Text size="small" className="text-ui-fg-subtle">
            Showing only cards from this import.
          </Text>
          <Button size="small" variant="secondary" onClick={() => setScopedToSnapshot(false)}>
            View the full catalogue instead
          </Button>
        </Container>
      )}

      <div className="flex flex-col gap-4">
        <ReviewSearchFilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setOffset(0)
          }}
          statusValue={status}
          onStatusChange={(value) => {
            setStatus(value)
            setOffset(0)
          }}
          statusOptions={STATUS_OPTIONS}
          searchPlaceholder="Search cards"
          languageValue={language}
          onLanguageChange={(value) => {
            setLanguage(value)
            setOffset(0)
          }}
          languageOptions={LANGUAGE_OPTIONS}
        />
        <Container className="divide-y p-0">
          {scopedWithNoCards ? (
            <Text size="small" className="p-4 text-ui-fg-subtle">
              No cards from this import still need images.
            </Text>
          ) : (
            <>
              <ReviewTable
                columns={columns}
                rows={query.data?.cards ?? []}
                rowKey={(row) => row.trading_card_id}
                onRowClick={(row) => navigate(`/imports/images/${row.trading_card_id}`)}
                isLoading={query.isLoading || !scopeReady}
                isError={query.isError}
                emptyMessage={
                  search || language || status
                    ? "No cards match your search."
                    : "No cards need images."
                }
              />
              {query.data && (
                <PaginationBar
                  offset={offset}
                  limit={query.data.limit}
                  count={query.data.count}
                  onOffsetChange={setOffset}
                />
              )}
            </>
          )}
        </Container>
      </div>
    </div>
  )
}

export default ImportsImagesPage
