import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { fetchJson } from "../../../components/imports/fetch-json"
import { getRememberedActiveImportSnapshot, rememberActiveImportSnapshot } from "../../../components/imports/active-import-session"
import CardImageThumbnail from "../../../components/imports/card-image-thumbnail"
import EntryDetailDrawer from "../../../components/imports/entry-detail-drawer"
import { formatEnumLabel } from "../../../components/imports/format-enum-label"
import { formatMoney } from "../../../components/imports/format-money"
import ImportStepper from "../../../components/imports/import-stepper"
import ImageNeedStatusBadge from "../../../components/imports/image-need-status-badge"
import ReplaceCardImageDialog from "../../../components/imports/replace-card-image-dialog"
import type { ImageListItem, ImageListResponse, VariantThumbnailsResponse } from "../../../components/imports/image-types"
import type { ImageReadiness, SnapshotEntryListItem, SnapshotEntryListResponse } from "../../../components/imports/pulse-import-types"
import PaginationBar from "../../../components/imports/pagination-bar"
import ReviewSearchFilterBar from "../../../components/imports/review-search-filter-bar"
import ReviewTable, { type ReviewTableColumn } from "../../../components/imports/review-table"
import "../../../styles/imports.css"

const PAGE_SIZE = 20
type EntrySortKey = "cardName" | "set" | "quantity" | "purchasePrice" | "marketPrice" | "salePrice" | "finish" | "variant" | "rarity" | "reviewStatus"
type SortDirection = "asc" | "desc"
type ImageTarget = { entryId: string; tradingCardId: string; tradingCardVariantId: string }

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
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const querySnapshotId = searchParams.get("snapshotId") ?? ""
  const [rememberedSnapshotId] = useState(getRememberedActiveImportSnapshot)
  const snapshotId = querySnapshotId || rememberedSnapshotId
  const [scopedToSnapshot, setScopedToSnapshot] = useState(Boolean(snapshotId))
  const [search, setSearch] = useState("")
  const [language, setLanguage] = useState("")
  const [status, setStatus] = useState("")
  const [offset, setOffset] = useState(0)
  const [entrySort, setEntrySort] = useState<{ key: EntrySortKey; direction: SortDirection }>({ key: "cardName", direction: "asc" })
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [replaceImageTarget, setReplaceImageTarget] = useState<ImageTarget | null>(null)

  const isScoped = scopedToSnapshot && Boolean(snapshotId)

  useEffect(() => {
    if (querySnapshotId) {
      rememberActiveImportSnapshot(querySnapshotId)
      return
    }
    if (rememberedSnapshotId) {
      navigate(`/imports/images?snapshotId=${encodeURIComponent(rememberedSnapshotId)}`, { replace: true })
    }
  }, [navigate, querySnapshotId, rememberedSnapshotId])

  const query = useQuery({
    queryKey: ["images-needing", { search, language, status, offset, isScoped, snapshotId }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (search.trim()) params.set("q", search.trim())
      if (language) params.set("language", language)
      if (status) params.set("status", status)
      if (isScoped) params.set("inventorySnapshotId", snapshotId)
      return fetchJson<ImageListResponse>(`/admin/trading-cards/needing-images?${params.toString()}`)
    },
    enabled: !isScoped,
    placeholderData: keepPreviousData,
  })

  const scopedEntriesQuery = useQuery({
    queryKey: ["images-snapshot-entries", snapshotId, offset, entrySort],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(offset), sortBy: entrySort.key, sortDirection: entrySort.direction,
        // Step 3 is for assigning photos to cards that actually exist —
        // a row still awaiting Step 2 review has nothing to attach a photo
        // to yet, so it must not appear here until it's been accepted.
        reviewStatus: "MATCHED",
      })
      return fetchJson<SnapshotEntryListResponse>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/entries?${params.toString()}`,
      )
    },
    enabled: isScoped,
    placeholderData: keepPreviousData,
  })
  const imageReadinessQuery = useQuery({
    queryKey: ["pulse-import-summary", snapshotId],
    queryFn: () => fetchJson<{ imageReadiness: ImageReadiness }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`,
    ),
    enabled: isScoped,
  })
  const scopedVariantIds = [...new Set(
    (scopedEntriesQuery.data?.entries ?? [])
      .map((entry) => entry.tradingCardVariantId)
      .filter((id): id is string => Boolean(id)),
  )]
  const scopedThumbnailsQuery = useQuery({
    queryKey: ["images-snapshot-thumbnails", snapshotId, scopedVariantIds],
    queryFn: () => fetchJson<VariantThumbnailsResponse>(
      `/admin/trading-cards/variants/images?variantIds=${scopedVariantIds.map(encodeURIComponent).join(",")}`,
    ),
    enabled: isScoped && scopedVariantIds.length > 0,
    placeholderData: keepPreviousData,
  })

  const imageTargetForEntry = (entry: SnapshotEntryListItem): ImageTarget | null => {
    if (!entry.tradingCardVariantId) return null
    const thumbnail = scopedThumbnailsQuery.data?.thumbnails[entry.tradingCardVariantId]
    const tradingCardId = thumbnail?.tradingCardId ?? entry.card?.tradingCardId
    if (!tradingCardId) return null
    return { entryId: entry.id, tradingCardId, tradingCardVariantId: entry.tradingCardVariantId }
  }

  const visibleScopedEntries = scopedEntriesQuery.data?.entries ?? []
  const replaceImageEntryIndex = replaceImageTarget
    ? visibleScopedEntries.findIndex((entry) => entry.id === replaceImageTarget.entryId)
    : -1
  const nextReplaceImageTarget = replaceImageEntryIndex >= 0
    ? visibleScopedEntries.slice(replaceImageEntryIndex + 1).map(imageTargetForEntry).find((target) => target !== null) ?? null
    : null

  const sortableHeader = (label: string, key: EntrySortKey) => {
    const active = entrySort.key === key
    const arrow = active ? (entrySort.direction === "asc" ? "↑" : "↓") : "↕"
    return (
      <button
        type="button"
        className="flex items-center gap-1 whitespace-nowrap"
        aria-label={`Sort by ${label}`}
        onClick={() => {
          setEntrySort((current) => ({
            key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
          }))
          setOffset(0)
        }}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={active ? "text-ui-fg-base" : "text-ui-fg-muted"}>{arrow}</span>
      </button>
    )
  }

  const scopedColumns: ReviewTableColumn<SnapshotEntryListItem>[] = [
    {
      header: "Card",
      cell: (row) => {
        const thumbnail = row.tradingCardVariantId ? scopedThumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        const target = imageTargetForEntry(row)
        // Step 3 is specifically for real uploaded photographs. A TCGdex
        // reference image is useful context elsewhere, but must not make a
        // card look complete here.
        const uploadedPhotoUrl = thumbnail?.source === "PHOTO" ? thumbnail.imageUrl : null
        return (
          <CardImageThumbnail
            imageUrl={uploadedPhotoUrl}
            alt={`${uploadedPhotoUrl ? "Replace" : "Upload"} image for ${row.card?.name ?? row.tcgdexCandidate?.name ?? row.providerReference}`}
            title={target
              ? (uploadedPhotoUrl ? "Click to replace the uploaded photo" : "Click to upload a card photo")
              : "This card isn't fully created yet — finish it on step 2, Sync with TCGdex"}
            onClick={target ? () => setReplaceImageTarget(target) : undefined}
          />
        )
      },
    },
    {
      header: "Card name",
      headerCell: sortableHeader("Card name", "cardName"),
      cell: (row) => (
        <div className="flex flex-col">
          <Text size="small" weight="plus">{row.card?.name ?? row.tcgdexCandidate?.name ?? "Not yet matched"}</Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {row.card ? `Card ${row.card.cardNumber}` : [row.tcgdexCandidate?.seriesName, row.tcgdexCandidate?.setName].filter(Boolean).join(" · ")}
          </Text>
        </div>
      ),
    },
    { header: "Set", headerCell: sortableHeader("Set", "set"), cell: (row) => row.card?.setDisplayName ?? row.tcgdexCandidate?.setName ?? "—" },
    { header: "Quantity", headerCell: sortableHeader("Quantity", "quantity"), cell: (row) => row.quantity },
    { header: "Purchase price", headerCell: sortableHeader("Purchase price", "purchasePrice"), cell: (row) => formatMoney(row.unitAcquisitionCost, row.currencyCode) },
    { header: "Market value", headerCell: sortableHeader("Market value", "marketPrice"), cell: (row) => formatMoney(row.unitMarketPrice, row.currencyCode) },
    { header: "Sale price", headerCell: sortableHeader("Sale price", "salePrice"), cell: (row) => formatMoney(row.unitSellingPrice, row.currencyCode) },
    { header: "Finish", headerCell: sortableHeader("Finish", "finish"), cell: (row) => formatEnumLabel(row.finishCandidate) },
    { header: "Variant", headerCell: sortableHeader("Variant", "variant"), cell: (row) => formatEnumLabel(row.specialTreatmentCandidate) },
    { header: "Rarity", headerCell: sortableHeader("Rarity", "rarity"), cell: (row) => {
      const importedRarity = row.rarityRaw && row.rarityRaw !== "—" ? row.rarityRaw : null
      return row.rarityCandidate ? formatEnumLabel(row.rarityCandidate) : (importedRarity ?? row.card?.rarityRaw ?? row.tcgdexCandidate?.providerRarity ?? "—")
    } },
    {
      header: "Image status",
      cell: (row) => {
        const thumbnail = row.tradingCardVariantId ? scopedThumbnailsQuery.data?.thumbnails[row.tradingCardVariantId] : undefined
        const uploaded = thumbnail?.source === "PHOTO" && Boolean(thumbnail.imageUrl)
        return <Badge size="2xsmall" color={uploaded ? "green" : "orange"}>{uploaded ? "Image Uploaded" : "Image Needed"}</Badge>
      },
    },
  ]

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
          {isScoped
            ? "This list shows the cards from this import that have been approved on step 2. Click an image placeholder to upload a real card photograph, or click the rest of a row to view its import details."
            : "This list shows every card that still needs a real photograph. Click a card, then upload a photo for each of its versions (for example, Near Mint and Holo are separate versions and each need their own photo). This page works on its own — you do not need to come here as part of an import, and you can add photos to a card at any time."}
        </Text>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isScoped ? (
            <Button variant="secondary" onClick={() => navigate(`/imports/snapshots/${encodeURIComponent(snapshotId)}`)}>
              Back: Sync with TCGDex
            </Button>
          ) : (
            <Text size="small"><Link to="/imports">Back to imports</Link></Text>
          )}
          {isScoped && (
            <div className="flex flex-col items-end gap-1">
              <Button
                disabled={!imageReadinessQuery.data?.imageReadiness.ready}
                onClick={() => navigate(`/imports/snapshots/${encodeURIComponent(snapshotId)}/proposals`)}
              >
                Next: Check and approve →
              </Button>
              {imageReadinessQuery.data && !imageReadinessQuery.data.imageReadiness.ready && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Upload images for all {imageReadinessQuery.data.imageReadiness.totalMatchedCards} cards to continue.
                </Text>
              )}
            </div>
          )}
        </div>
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

      {isScoped ? (
        <Container className="flex flex-col gap-3 p-0">
          <ReviewTable
            className="ht-imports-rows-table"
            columns={scopedColumns}
            rows={scopedEntriesQuery.data?.entries ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedEntryId(row.id)}
            isLoading={scopedEntriesQuery.isLoading}
            isError={scopedEntriesQuery.isError || scopedThumbnailsQuery.isError}
            emptyMessage="No cards were found in this import."
          />
          {scopedEntriesQuery.data && (
            <PaginationBar
              offset={offset}
              limit={scopedEntriesQuery.data.limit}
              count={scopedEntriesQuery.data.count}
              onOffsetChange={setOffset}
            />
          )}
        </Container>
      ) : (
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
          <ReviewTable
            columns={columns}
            rows={query.data?.cards ?? []}
            rowKey={(row) => row.trading_card_id}
            onRowClick={(row) => navigate(`/imports/images/${row.trading_card_id}`)}
            isLoading={query.isLoading}
            isError={query.isError}
            emptyMessage={
              search || language || status
                ? "No cards match your search."
                : isScoped
                  ? "No cards from this import need images."
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
        </Container>
      </div>
      )}

      {replaceImageTarget && (
        <ReplaceCardImageDialog
          key={`${replaceImageTarget.tradingCardId}:${replaceImageTarget.tradingCardVariantId}`}
          tradingCardId={replaceImageTarget.tradingCardId}
          tradingCardVariantId={replaceImageTarget.tradingCardVariantId}
          onClose={() => setReplaceImageTarget(null)}
          onNext={nextReplaceImageTarget ? () => setReplaceImageTarget(nextReplaceImageTarget) : undefined}
          showNext
          onUploaded={() => {
            queryClient.invalidateQueries({ queryKey: ["images-snapshot-thumbnails", snapshotId] })
            queryClient.invalidateQueries({ queryKey: ["images-needing"] })
            queryClient.invalidateQueries({ queryKey: ["pulse-import-summary", snapshotId] })
          }}
        />
      )}

      {selectedEntryId && (() => {
        const visibleEntries = scopedEntriesQuery.data?.entries ?? []
        const selectedEntryIndex = visibleEntries.findIndex((entry) => entry.id === selectedEntryId)
        const selectedEntry = visibleEntries[selectedEntryIndex]
        if (!selectedEntry) return null
        const thumbnail = selectedEntry.tradingCardVariantId
          ? scopedThumbnailsQuery.data?.thumbnails[selectedEntry.tradingCardVariantId]
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
    </div>
  )
}

export default ImportsImagesPage
