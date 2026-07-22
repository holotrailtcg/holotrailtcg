import { Badge, Button, Drawer, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { fetchJson } from "./fetch-json"
import { formatEnumLabel } from "./format-enum-label"
import { formatMoney } from "./format-money"
import MatchingStatusBadge from "./matching-status-badge"
import RowOutcomeBadge from "./row-outcome-badge"
import type { SnapshotDiagnosticListResponse, SnapshotEntryListItem } from "./pulse-import-types"
import type { CardImageDetail, VariantThumbnail } from "./image-types"

const DIAGNOSTIC_SEVERITY_COLOR: Record<string, "red" | "orange" | "green" | "grey"> = {
  ERROR: "red", WARNING: "orange", INFO: "green",
}

const parseCardNumber = (providerReference: string) => {
  const numberReference = providerReference.split("|")[1] ?? ""
  const [cardNumber, totalNumber] = numberReference.split("/")

  return {
    cardNumber: cardNumber || null,
    totalNumber: totalNumber || null,
  }
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

interface EntryDetailDrawerProps {
  snapshotId: string
  row: SnapshotEntryListItem
  thumbnail: VariantThumbnail | undefined
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  /** Stage 1: opens the alternative-TCGdex-match dialog for this row. Omitted where rematching doesn't make sense (e.g. no snapshot entry id available). */
  onFindAlternativeMatch?: () => void
}

/** Full detail for one import row, opened by clicking its table row. */
const EntryDetailDrawer = ({ snapshotId, row, thumbnail, onClose, onPrevious, onNext, onFindAlternativeMatch }: EntryDetailDrawerProps) => {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
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
  }, [row.id])

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
          <div>
            <Drawer.Title>{cardName}</Drawer.Title>
            <Text size="xsmall" className="text-ui-fg-subtle">Import row {row.rowNumber ?? "—"}</Text>
          </div>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-6 overflow-y-auto">
          <div className="grid gap-6 md:grid-cols-[minmax(16rem,1fr)_minmax(20rem,1fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <Text size="small" weight="plus">{cardName}</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {selectedUploadedImage
                    ? (safeSelectedImageIndex === 0 ? "Primary uploaded image" : `Uploaded image ${safeSelectedImageIndex + 1} of ${readyImages.length}`)
                    : displayedImageUrl ? "TCGDex reference image" : "No image yet"}
                </Text>
              </div>
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
              {selectedUploadedImage && tcgdexReferenceUrl && (
                <Text size="xsmall" className="text-ui-fg-subtle">Hover over the photograph to view the TCGDex image.</Text>
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
              <DetailRow label="Finish" value={formatEnumLabel(row.finishCandidate)} />
              <DetailRow label="Variant" value={formatEnumLabel(row.specialTreatmentCandidate)} />
              <DetailRow label="Purchase price" value={formatMoney(row.unitAcquisitionCost, row.currencyCode)} />
              <DetailRow label="Market price" value={formatMoney(row.unitMarketPrice, row.currencyCode)} />
              <DetailRow label="Sale price" value={formatMoney(row.unitSellingPrice, row.currencyCode)} />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <Text size="small" weight="plus">Status</Text>
            <div className="flex flex-wrap items-center gap-2">
              <RowOutcomeBadge outcome={row.outcome} />
              <MatchingStatusBadge status={!row.tradingCardVariantId && row.tcgdexCandidate?.reviewStatus !== "ACCEPTED" ? "AWAITING_REVIEW" : row.matchingStatus} />
            </div>
          </div>

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

          {onFindAlternativeMatch && (
            <div className="border-t pt-4">
              <Button type="button" variant="secondary" onClick={onFindAlternativeMatch}>
                Find alternative TCGdex match
              </Button>
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
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

export default EntryDetailDrawer
