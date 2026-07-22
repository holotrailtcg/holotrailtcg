import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Table, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router-dom"
import CardImageThumbnail from "../../components/imports/card-image-thumbnail"
import { fetchJson } from "../../components/imports/fetch-json"
import { formatMoney } from "../../components/imports/format-money"

interface InventoryOverviewRow {
  tradingCardVariantId: string
  sku: string
  quantity: number
  imageUrl: string | null
  cardName: string
  series: string | null
  set: string
  purchasePrice: number
  marketValue: number
  profitAndLoss: number
  rarity: string | null
  medusaProductId: string | null
}

interface InventoryOverviewTotals {
  totalCards: number
  totalPurchasePrice: number
  totalMarketValue: number
}

interface InventoryOverviewResponse {
  rows: InventoryOverviewRow[]
  count: number
  limit: number
  offset: number
  totals: InventoryOverviewTotals
}

const PAGE_SIZE = 20
// The overview API returns money as plain numbers (major units, e.g. pounds)
// rather than the bigNumber strings other Pulse-import screens format —
// GBP is the only currency this store trades in, so it is hard-coded here
// rather than threaded through from each holding's currency_code.
const formatGbp = (value: number | null) => formatMoney(value === null ? null : value.toFixed(2), "GBP")

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Container className="flex flex-col gap-1 p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Heading level="h2">{value}</Heading>
    </Container>
  )
}

function ProfitAndLossCell({ value }: { value: number }) {
  const className = value > 0 ? "text-ui-tag-green-text" : value < 0 ? "text-ui-tag-red-text" : "text-ui-fg-subtle"
  return <span className={className}>{formatGbp(value)}</span>
}

const CardInventoryPage = () => {
  const [offset, setOffset] = useState(0)

  const overviewQuery = useQuery({
    queryKey: ["trading-card-inventory-overview", offset],
    queryFn: () =>
      fetchJson<InventoryOverviewResponse>(
        `/admin/trading-cards/inventory-overview?limit=${PAGE_SIZE}&offset=${offset}`,
      ),
    retry: false,
  })

  const totals = overviewQuery.data?.totals
  const rows = overviewQuery.data?.rows ?? []
  const count = overviewQuery.data?.count ?? 0
  const hasPrevious = offset > 0
  const hasNext = offset + PAGE_SIZE < count

  return (
    <div className="flex flex-col gap-6">
      <Container className="flex flex-col gap-2 p-6">
        <Heading level="h1">Card inventory</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          One row per sellable card variant, with its live Medusa stock quantity, weighted-average purchase
          cost and latest Pulse market value. Rows with no recorded acquisition or market price show
          {" £0.00 — that means no priced data yet, not that the card is worthless."}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          This view is read-only. To adjust stock quantities, create reservations, or move stock between
          locations, use Medusa's built-in <Link to="/inventory" className="text-ui-fg-interactive underline">Inventory</Link> page.
        </Text>
      </Container>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Total cards" value={totals ? String(totals.totalCards) : "—"} />
        <StatTile label="Total purchase price" value={totals ? formatGbp(totals.totalPurchasePrice) : "—"} />
        <StatTile label="Total inventory market value" value={totals ? formatGbp(totals.totalMarketValue) : "—"} />
      </div>

      <Container className="flex flex-col gap-3 p-0">
        {overviewQuery.isError && (
          <Text size="small" className="p-4 text-ui-fg-error" role="alert">
            Inventory overview could not be loaded.
          </Text>
        )}
        {overviewQuery.isLoading && (
          <Text size="small" className="p-4 text-ui-fg-subtle">
            Loading…
          </Text>
        )}
        {!overviewQuery.isLoading && rows.length === 0 && !overviewQuery.isError && (
          <Text size="small" className="p-4 text-ui-fg-subtle">
            No card variants found yet.
          </Text>
        )}
        {rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Image</Table.HeaderCell>
                <Table.HeaderCell>SKU</Table.HeaderCell>
                <Table.HeaderCell>Card name</Table.HeaderCell>
                <Table.HeaderCell className="text-center">Quantity</Table.HeaderCell>
                <Table.HeaderCell>Series</Table.HeaderCell>
                <Table.HeaderCell>Set</Table.HeaderCell>
                <Table.HeaderCell className="text-center">Purchase price</Table.HeaderCell>
                <Table.HeaderCell className="text-center">Market value</Table.HeaderCell>
                <Table.HeaderCell className="text-center">P&amp;L</Table.HeaderCell>
                <Table.HeaderCell>Rarity</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.tradingCardVariantId}>
                  <Table.Cell>
                    {row.medusaProductId ? (
                      <Link
                        to={`/products/${encodeURIComponent(row.medusaProductId)}`}
                        title="View this card's Medusa product"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <CardImageThumbnail imageUrl={row.imageUrl} alt={row.cardName} />
                      </Link>
                    ) : (
                      <CardImageThumbnail imageUrl={row.imageUrl} alt={row.cardName} />
                    )}
                  </Table.Cell>
                  <Table.Cell>{row.sku}</Table.Cell>
                  <Table.Cell>{row.cardName}</Table.Cell>
                  <Table.Cell className="text-center">{row.quantity}</Table.Cell>
                  <Table.Cell>{row.series ?? "—"}</Table.Cell>
                  <Table.Cell>{row.set}</Table.Cell>
                  <Table.Cell className="text-center">{formatGbp(row.purchasePrice)}</Table.Cell>
                  <Table.Cell className="text-center">{formatGbp(row.marketValue)}</Table.Cell>
                  <Table.Cell className="text-center">
                    <ProfitAndLossCell value={row.profitAndLoss} />
                  </Table.Cell>
                  <Table.Cell>{row.rarity ?? "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        <div className="flex items-center justify-between p-4">
          <Text size="small" className="text-ui-fg-subtle">
            {count > 0 ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, count)} of ${count}` : null}
          </Text>
          <div className="flex gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={!hasPrevious}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="small"
              variant="secondary"
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Card Inventory" })
export default CardInventoryPage
