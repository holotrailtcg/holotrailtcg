import { Badge, Button, Drawer, Label, Select, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { fetchJson, postAction } from "./fetch-json"
import { formatEnumLabel } from "./format-enum-label"
import { formatMoney } from "./format-money"
import { parseCardNumber } from "./parse-card-number"
import MatchingStatusBadge from "./matching-status-badge"
import RowOutcomeBadge from "./row-outcome-badge"
import { SearchableCategorySelect } from "../ebay/searchable-category-select"
import type { StoreCategoryLike } from "../ebay/category-tree"
import type { InventoryAuditEntry, SnapshotDiagnosticListResponse, SnapshotEntryListItem } from "./pulse-import-types"
import type { CardImageDetail, VariantThumbnail } from "./image-types"

const DIAGNOSTIC_SEVERITY_COLOR: Record<string, "red" | "orange" | "green" | "grey"> = {
  ERROR: "red", WARNING: "orange", INFO: "green",
}

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-[9rem_1fr] items-baseline gap-4 border-b py-2 last:border-b-0">
    <Text size="xsmall" className="text-ui-fg-subtle">{label}</Text>
    <Text size="small">{value}</Text>
  </div>
)

const formatDiagnosticMessage = (code: string, message: string) => {
  if (code === "NO_VARIANT_MATCH") {
    return "This card will be linked or created when approved."
  }

  return message
}

/** History actors are either a reviewer's own actor string or a "system:kebab-case-reason" marker — never shown as a raw enum-like value. */
const formatHistoryActor = (actor: string) => {
  if (actor.startsWith("system:")) {
    const reason = actor.slice("system:".length).split("-").filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    return `System (${reason})`
  }
  return actor
}

interface EntryDetailDrawerProposal {
  id: string
  changeKind: string
  proposedEbayStoreCategoryId: string | null
  proposedCategoryReason: string | null
  confirmedEbayStoreCategoryId: string | null
}

interface EntryDetailDrawerProps {
  snapshotId: string
  row: SnapshotEntryListItem
  thumbnail: VariantThumbnail | undefined
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  /** Stage 1: opens the alternative-TCGdex-match dialog for this row. Omitted where rematching doesn't make sense (e.g. no snapshot entry id available). */
  onFindAlternativeMatch?: () => void
  /** Stage 1: opens the illustrator-correction dialog for this row's already-matched card. Omitted when the row has no resolved trading card yet. */
  onEditIllustrator?: () => void
  /** Step 4 (proposals page) only — the matching inventory proposal, so its eBay category state can be shown here too. Omitted on Step 2/3, where no proposal-level category assignment exists yet. */
  proposal?: EntryDetailDrawerProposal
  /** Resolves an eBay Store category id to its human-readable path; falls back to the raw id if the caller can't resolve it yet. Required whenever `proposal` is given. */
  ebayCategoryName?: (id: string | null) => string | null
  /** Called after this drawer confirms/overrides `proposal`'s eBay category, so the caller can refresh its own table/summary state. */
  onCategoryConfirmed?: () => void
  /** Step 4 only — this proposal's audit history, shown here instead of a separate expanding row panel. */
  history?: InventoryAuditEntry[]
  historyLoading?: boolean
}

/** Full detail for one import row, opened by clicking its table row. */
const EntryDetailDrawer = ({
  snapshotId, row, thumbnail, onClose, onPrevious, onNext, onFindAlternativeMatch, onEditIllustrator,
  proposal, ebayCategoryName, onCategoryConfirmed, history, historyLoading,
}: EntryDetailDrawerProps) => {
  const queryClient = useQueryClient()
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [selectedCandidateOption, setSelectedCandidateOption] = useState<{ tcgdexCardId: string; localId: string; name: string; image: string | null } | null>(null)
  const [categoryEnvironment, setCategoryEnvironment] = useState("SANDBOX")
  const [selectedCategoryId, setSelectedCategoryId] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const categoriesQuery = useQuery({
    queryKey: ["ebay-store-categories", categoryEnvironment],
    queryFn: () => fetchJson<{ accountId: string; categories: StoreCategoryLike[] }>(`/admin/ebay/store-categories?environment=${categoryEnvironment}`),
    enabled: Boolean(proposal && proposal.changeKind === "NEW_HOLDING"),
    retry: false,
  })
  const confirmCategoryMutation = useMutation({
    mutationFn: (storeCategoryId: string) =>
      postAction(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposal!.id)}/category`, { environment: categoryEnvironment, storeCategoryId }),
    onSuccess: () => {
      toast.success("Category confirmed.")
      setSelectedCategoryId("")
      queryClient.invalidateQueries({ queryKey: ["inventory-proposal-detail", proposal?.id] })
      onCategoryConfirmed?.()
    },
    onError: () => toast.error("This category could not be confirmed. It may no longer be active."),
  })
  const { cardNumber, totalNumber } = parseCardNumber(row.providerReference)
  const displayCardNumber = cardNumber ?? row.card?.cardNumber ?? "—"
  const displayTotalNumber = totalNumber ?? "—"
  const cardName = row.tcgdexCandidate?.name ?? row.card?.name ?? row.cardIdentityHint ?? "Imported card"
  const seriesName = row.tcgdexCandidate?.seriesName ?? "—"
  const setName = row.tcgdexCandidate?.setName ?? row.card?.setDisplayName ?? "—"
  const importedRarity = row.rarityRaw && row.rarityRaw !== "—" ? row.rarityRaw : null
  const rarity = row.rarityCandidate
    ? formatEnumLabel(row.rarityCandidate)
    : (importedRarity ?? row.card?.rarityRaw ?? row.tcgdexCandidate?.providerRarity ?? "—")
  const tradingCardId = thumbnail?.tradingCardId ?? row.card?.tradingCardId ?? null

  const cardImagesQuery = useQuery({
    queryKey: ["card-images", tradingCardId],
    queryFn: () => fetchJson<CardImageDetail>(`/admin/trading-cards/${encodeURIComponent(tradingCardId!)}/images`),
    enabled: Boolean(tradingCardId && row.tradingCardVariantId),
  })
  const readyImages = cardImagesQuery.data?.variants
    .find((variant) => variant.id === row.tradingCardVariantId)?.ready_images ?? []
  const safeSelectedImageIndex = readyImages.length > 0 ? Math.min(selectedImageIndex, readyImages.length - 1) : 0
  const selectedUploadedImage = readyImages[safeSelectedImageIndex] ?? null
  const tcgdexReferenceUrl = cardImagesQuery.data?.tcgdex_reference_artwork_url
    ?? (thumbnail?.source === "TCGDEX" ? thumbnail.imageUrl : null)
    ?? row.tcgdexCandidate?.referenceArtworkUrl
    ?? null
  const displayedImageUrl = selectedUploadedImage?.imageUrl ?? tcgdexReferenceUrl

  useEffect(() => {
    setSelectedImageIndex(0)
    setSelectedCandidateOption(null)
    setHistoryOpen(false)
  }, [row.id])

  const resolveAmbiguousMutation = useMutation({
    mutationFn: () => postAction<{ candidate: unknown }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/tcgdex-lookup/candidates/${encodeURIComponent(row.tcgdexCandidate!.id)}/resolve`,
      { tcgdexCardId: selectedCandidateOption!.tcgdexCardId },
    ),
    onSuccess: () => {
      toast.success("Marked as Match Found — approve it from the Rows table to create the card.")
      setSelectedCandidateOption(null)
      queryClient.invalidateQueries({ queryKey: ["pulse-import-entries", snapshotId] })
      queryClient.invalidateQueries({ queryKey: ["pulse-import-summary", snapshotId] })
    },
    onError: (error: Error) => toast.error(error.message || "This candidate could not be resolved. Please try again."),
  })

  const diagnosticsQuery = useQuery({
    queryKey: ["pulse-import-entry-diagnostics", snapshotId, row.id],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50", offset: "0", snapshotEntryId: row.id })
      return fetchJson<SnapshotDiagnosticListResponse>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/diagnostics?${params.toString()}`,
      )
    },
  })

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }}>
      <Drawer.Content className="ht-imports-entry-drawer">
        <Drawer.Header>
          <div className="flex flex-1 items-center justify-between gap-4">
            <div>
              <Drawer.Title>{cardName}</Drawer.Title>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Text size="xsmall" className="text-ui-fg-subtle">Row:</Text>
                <RowOutcomeBadge outcome={row.outcome} />
              </div>
              <div className="flex items-center gap-2">
                <Text size="xsmall" className="text-ui-fg-subtle">Review status:</Text>
                <MatchingStatusBadge status={
                  row.tradingCardVariantId
                    ? "CARD_MATCHED"
                    : row.tcgdexCandidate?.matchOutcome === "AMBIGUOUS"
                      ? "TCGDEX_AMBIGUOUS"
                      : row.tcgdexCandidate?.matchOutcome === "MATCHED" && row.tcgdexCandidate.reviewStatus !== "ACCEPTED"
                        ? "MATCHED"
                        : row.matchingStatus
                } />
              </div>
              {row.tradingCardVariantId && (
                <div className="flex items-center gap-2">
                  <Text size="xsmall" className="text-ui-fg-subtle">Image status:</Text>
                  {cardImagesQuery.isLoading ? (
                    <Text size="xsmall" className="text-ui-fg-subtle">Loading…</Text>
                  ) : (
                    <Badge className="ht-imports-badge" size="2xsmall" color={readyImages.length > 0 ? "green" : "orange"}>
                      {readyImages.length > 0 ? "Image Uploaded" : "Image Needed"}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-6 overflow-y-auto">
          <div className="grid gap-6 md:grid-cols-[minmax(16rem,1fr)_minmax(20rem,1fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="group relative flex min-h-80 items-center justify-center overflow-hidden rounded-md">
                {displayedImageUrl ? (
                  <>
                    <img
                      src={displayedImageUrl}
                      alt={cardName}
                      className={`h-full max-h-[30rem] w-full object-contain transition-opacity ${selectedUploadedImage && tcgdexReferenceUrl ? "group-hover:opacity-0" : ""}`}
                    />
                    {selectedUploadedImage && tcgdexReferenceUrl && (
                      <img
                        src={tcgdexReferenceUrl}
                        alt={`${cardName} TCGDex reference`}
                        className="absolute inset-0 h-full max-h-[30rem] w-full object-contain opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    )}
                    {readyImages.length > 1 && (
                      <>
                        <Button
                          size="small"
                          variant="secondary"
                          className="absolute left-2 top-1/2 z-10 -translate-y-1/2"
                          aria-label="Previous uploaded image"
                          onClick={() => setSelectedImageIndex((safeSelectedImageIndex - 1 + readyImages.length) % readyImages.length)}
                        >
                          ←
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
                          aria-label="Next uploaded image"
                          onClick={() => setSelectedImageIndex((safeSelectedImageIndex + 1) % readyImages.length)}
                        >
                          →
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  <span aria-hidden="true" className="text-ui-fg-muted text-5xl">🂠</span>
                )}
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle text-center">
                {selectedUploadedImage
                  ? (safeSelectedImageIndex === 0 ? "Primary uploaded image" : `Uploaded image ${safeSelectedImageIndex + 1} of ${readyImages.length}`)
                  : displayedImageUrl ? "TCGDex reference image" : "No image yet"}
              </Text>
              {selectedUploadedImage && tcgdexReferenceUrl && (
                <Text size="xsmall" className="text-ui-fg-subtle text-center">Hover over the photograph to view the TCGDex image.</Text>
              )}
              {readyImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {readyImages.map((image, index) => image.imageUrl && (
                    <button
                      type="button"
                      key={image.id}
                      className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border ${index === safeSelectedImageIndex ? "ring-2 ring-ui-fg-interactive" : ""}`}
                      aria-label={`View uploaded image ${index + 1}`}
                      onClick={() => setSelectedImageIndex(index)}
                    >
                      <img src={image.imageUrl} alt={`Uploaded ${index + 1}`} className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <DetailRow label="Card number" value={`${displayCardNumber} / ${displayTotalNumber}`} />
              <DetailRow label="Series" value={seriesName} />
              <DetailRow label="Set" value={setName} />
              <DetailRow label="Rarity" value={rarity} />
              <DetailRow label="Illustrator" value={row.tcgdexCandidate?.illustrator ?? "—"} />
              <DetailRow label="Finish" value={formatEnumLabel(row.finishCandidate)} />
              <DetailRow label="Variant" value={formatEnumLabel(row.specialTreatmentCandidate)} />
              <DetailRow label="Purchase price" value={formatMoney(row.unitAcquisitionCost, row.currencyCode)} />
              <DetailRow label="Market price" value={formatMoney(row.unitMarketPrice, row.currencyCode)} />
              <DetailRow label="Sale price" value={formatMoney(row.unitSellingPrice, row.currencyCode)} />
            </div>
          </div>

          {proposal && proposal.changeKind === "NEW_HOLDING" && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <Text size="small" weight="plus">eBay category</Text>
              <div className="flex items-center gap-2">
                <Text size="xsmall" className="text-ui-fg-subtle">Confirmed:</Text>
                {proposal.confirmedEbayStoreCategoryId ? (
                  <Badge size="2xsmall" color="green">{ebayCategoryName?.(proposal.confirmedEbayStoreCategoryId)}</Badge>
                ) : (
                  <Text size="small" className="text-ui-fg-error">Not yet confirmed</Text>
                )}
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="drawer-category-environment">eBay environment</Label>
                  <Select value={categoryEnvironment} onValueChange={(value) => { setCategoryEnvironment(value); setSelectedCategoryId("") }}>
                    <Select.Trigger id="drawer-category-environment" aria-label="Environment">
                      <Select.Value placeholder="Environment" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="SANDBOX">Sandbox</Select.Item>
                      <Select.Item value="PRODUCTION">Production</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                <SearchableCategorySelect
                  id="drawer-category-select"
                  ariaLabel="Choose an eBay category"
                  categories={categoriesQuery.data?.categories ?? []}
                  value={selectedCategoryId}
                  onChange={setSelectedCategoryId}
                  placeholder="Search categories…"
                />
                <Button
                  size="small"
                  variant="secondary"
                  disabled={!selectedCategoryId}
                  isLoading={confirmCategoryMutation.isPending}
                  onClick={() => confirmCategoryMutation.mutate(selectedCategoryId)}
                >
                  Confirm category
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Text size="small" weight="plus">Diagnostics</Text>
            {diagnosticsQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
            {diagnosticsQuery.data && diagnosticsQuery.data.diagnostics.length === 0 && (
              <Text size="small" className="text-ui-fg-subtle">No diagnostics for this row.</Text>
            )}
            {diagnosticsQuery.data && diagnosticsQuery.data.diagnostics.length > 0 && (
              <ul className="flex flex-col gap-2">
                {diagnosticsQuery.data.diagnostics.map((diagnostic) => (
                  <li key={diagnostic.id} className="flex items-start gap-2">
                    <Badge size="2xsmall" color={DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity] ?? "grey"}>
                      {diagnostic.severity}
                    </Badge>
                    <Text size="small">{formatDiagnosticMessage(diagnostic.code, diagnostic.message)}</Text>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {row.tcgdexCandidate?.matchOutcome === "AMBIGUOUS" && row.tcgdexCandidate.candidateOptions && (
            <div className="flex flex-col gap-3 border-t pt-4">
              <Text size="small" weight="plus">View matches</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                TCGdex found more than one plausible card for this row — pick the correct one below.
              </Text>
              <div className="flex flex-col gap-1">
                <Label htmlFor="view-matches-select">Candidate</Label>
                <select
                  id="view-matches-select"
                  className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm"
                  value={selectedCandidateOption?.tcgdexCardId ?? ""}
                  onChange={(event) => {
                    const option = row.tcgdexCandidate!.candidateOptions!.find((candidate) => candidate.tcgdexCardId === event.target.value)
                    setSelectedCandidateOption(option ?? null)
                  }}
                >
                  <option value="">Choose a card…</option>
                  {row.tcgdexCandidate.candidateOptions.map((candidate) => (
                    <option key={candidate.tcgdexCardId} value={candidate.tcgdexCardId}>
                      {candidate.name} (#{candidate.localId})
                    </option>
                  ))}
                </select>
              </div>
              {selectedCandidateOption && (
                <div className="flex items-center gap-3 border p-2">
                  {selectedCandidateOption.image && (
                    <img src={`${selectedCandidateOption.image}/low.webp`} alt={selectedCandidateOption.name} className="h-16 w-auto object-contain" />
                  )}
                  <div className="flex-1">
                    <Text size="small" weight="plus">{selectedCandidateOption.name}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">#{selectedCandidateOption.localId}</Text>
                  </div>
                </div>
              )}
              <Button
                type="button" variant="secondary" disabled={!selectedCandidateOption}
                isLoading={resolveAmbiguousMutation.isPending} onClick={() => resolveAmbiguousMutation.mutate()}
              >
                Mark as Match Found
              </Button>
            </div>
          )}

          {(onFindAlternativeMatch || onEditIllustrator) && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {onFindAlternativeMatch && (
                <Button type="button" variant="secondary" onClick={onFindAlternativeMatch}>
                  Find alternative TCGdex match
                </Button>
              )}
              {onEditIllustrator && (
                <Button type="button" variant="secondary" onClick={onEditIllustrator}>
                  Correct illustrator
                </Button>
              )}
            </div>
          )}

          <div className="mt-auto flex items-center justify-between border-t pt-4">
            <Button type="button" variant="secondary" disabled={!onPrevious} onClick={onPrevious}>
              ← Previous
            </Button>
            <Button type="button" variant="secondary" disabled={!onNext} onClick={onNext}>
              Next →
            </Button>
          </div>

          {proposal && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <button
                type="button"
                className="flex items-center gap-1 text-left"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <Text size="small" weight="plus">History</Text>
                <span aria-hidden="true" className="text-ui-fg-muted">{historyOpen ? "▲" : "▼"}</span>
              </button>
              {historyOpen && (
                <>
                  {historyLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
                  {history && history.length === 0 && <Text size="small" className="text-ui-fg-subtle">No history yet.</Text>}
                  {history && history.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {history.map((entry) => (
                        <li key={entry.id}>
                          <Text size="small">
                            {formatEnumLabel(entry.action)} · {formatHistoryActor(entry.actor)} · {new Date(entry.createdAt).toLocaleString()}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

export default EntryDetailDrawer
