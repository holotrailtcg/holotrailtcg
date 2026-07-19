import { Badge, Drawer, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import CardImageThumbnail from "./card-image-thumbnail"
import { fetchJson } from "./fetch-json"
import { formatEnumLabel } from "./format-enum-label"
import { formatMoney } from "./format-money"
import MatchingStatusBadge from "./matching-status-badge"
import RowOutcomeBadge from "./row-outcome-badge"
import type { SnapshotDiagnosticListResponse, SnapshotEntryListItem } from "./pulse-import-types"
import type { VariantThumbnail } from "./image-types"

const DIAGNOSTIC_SEVERITY_COLOR: Record<string, "red" | "orange" | "green" | "grey"> = {
  ERROR: "red", WARNING: "orange", INFO: "green",
}

interface EntryDetailDrawerProps {
  snapshotId: string
  row: SnapshotEntryListItem
  thumbnail: VariantThumbnail | undefined
  onClose: () => void
}

/** Full detail for one import row, opened by clicking its table row. */
const EntryDetailDrawer = ({ snapshotId, row, thumbnail, onClose }: EntryDetailDrawerProps) => {
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
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Row {row.rowNumber ?? "—"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center gap-3">
            <CardImageThumbnail imageUrl={thumbnail?.imageUrl ?? null} alt={row.providerReference} />
            <div className="flex flex-col">
              <Text size="small" weight="plus">{row.providerReference}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {thumbnail?.source === "PHOTO" ? "Real photograph" : thumbnail?.source === "TCGDEX" ? "TCGdex reference image" : "No image yet"}
              </Text>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Quantity</Text>
              <Text size="small">{row.quantity}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Finish</Text>
              <Text size="small">{formatEnumLabel(row.finishCandidate)}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Treatment</Text>
              <Text size="small">{formatEnumLabel(row.specialTreatmentCandidate)}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Rarity</Text>
              <Text size="small">{row.rarityCandidate ? formatEnumLabel(row.rarityCandidate) : (row.rarityRaw ?? "—")}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Purchase price</Text>
              <Text size="small">{formatMoney(row.unitAcquisitionCost, row.currencyCode)}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Market value</Text>
              <Text size="small">{formatMoney(row.unitMarketPrice, row.currencyCode)}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">Sale price</Text>
              <Text size="small">{formatMoney(row.unitSellingPrice, row.currencyCode)}</Text>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RowOutcomeBadge outcome={row.outcome} />
            <MatchingStatusBadge status={row.matchingStatus} />
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
                    <Text size="small">{diagnostic.message}</Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

export default EntryDetailDrawer
