import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import {
  CARD_CONDITION_LABELS, CARD_FINISH_LABELS, SPECIAL_TREATMENT_LABELS,
  type CardCondition, type CardFinish, type SpecialTreatment,
} from "../../modules/trading-cards/types"

const CONDITION_SOURCE_LABELS: Record<string, string> = { EXPLICIT: "Explicit", DEFAULTED: "Defaulted" }

/** Labels for TCGdex's own `variants` flags — deliberately separate from `CARD_FINISH_LABELS`, which labels our confirmed `CardFinish` enum, not TCGdex's "which finishes exist for this print" flags. */
const TCGDEX_VARIANT_LABELS: Record<"normal" | "reverse" | "holo" | "firstEdition", string> = {
  normal: "Normal", reverse: "Reverse Holo", holo: "Holo", firstEdition: "1st Edition",
}

interface EbayCategoryView { name: string; path: string }

interface TcgdexExtrasView {
  illustrator: string | null
  types: string[] | null
  variants: { normal: boolean; reverse: boolean; holo: boolean; firstEdition: boolean } | null
}

interface TradingCardView {
  id: string
  name: string
  card_number: string
  rarity_raw: string | null
  rarity: string | null
  medusa_product_id: string
  card_set: { display_name: string; language: string }
  tcgdex_extras: TcgdexExtrasView | null
  variants: Array<{
    id: string
    medusa_product_variant_id: string
    condition: CardCondition
    condition_source: string
    finish: CardFinish
    finish_confirmed: boolean
    special_treatment: SpecialTreatment
    special_treatment_confirmed: boolean
    sku: string
    price_locked: boolean
    price_locked_at: string | null
    price_locked_actor: string | null
    price_lock_reason: string | null
    is_high_value_track_individually: boolean
    ebay_category: EbayCategoryView | null
  }>
}

interface WidgetProps { data: { id: string } }

const TradingCardWidget = ({ data }: WidgetProps) => {
  const { data: response, isLoading, isError } = useQuery({
    queryKey: ["trading-card-by-product", data.id],
    queryFn: async (): Promise<{ trading_card: TradingCardView | null }> => {
      const result = await fetch(`/admin/trading-cards/by-product/${encodeURIComponent(data.id)}`, {
        credentials: "include",
      })
      if (!result.ok) throw new Error("Unable to load trading-card details")
      return result.json()
    },
  })

  if (!isLoading && !isError && !response?.trading_card) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Trading card</Heading>
        {isLoading && <Text size="small" className="text-ui-fg-subtle">Loading trading-card details…</Text>}
        {isError && <Text size="small" className="text-ui-fg-error">Trading-card details could not be loaded.</Text>}
        {response?.trading_card && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-ui-fg-subtle">
            <Text size="small">{response.trading_card.name}</Text>
            <Text size="small">{response.trading_card.card_set.display_name}</Text>
            <Text size="small">{response.trading_card.card_set.language}</Text>
            <Text size="small">{response.trading_card.card_number}</Text>
            <Text size="small" className="col-span-2">
              Rarity: {response.trading_card.rarity ?? response.trading_card.rarity_raw ?? "Unmapped"}
            </Text>
            <Text size="small" className="col-span-2">Product: {response.trading_card.medusa_product_id}</Text>
          </div>
        )}
        {response?.trading_card?.tcgdex_extras && (
          <div className="mt-4 flex flex-col gap-2">
            <Text size="small" weight="plus">TCGdex reference data</Text>
            {response.trading_card.tcgdex_extras.variants && (
              <div className="flex flex-wrap items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">Available finishes:</Text>
                {(Object.entries(response.trading_card.tcgdex_extras.variants) as Array<[keyof typeof TCGDEX_VARIANT_LABELS, boolean]>)
                  .filter(([, present]) => present)
                  .map(([key]) => <Badge key={key} size="2xsmall">{TCGDEX_VARIANT_LABELS[key]}</Badge>)}
              </div>
            )}
            {response.trading_card.tcgdex_extras.illustrator && (
              <Text size="small" className="text-ui-fg-subtle">
                Illustrator: {response.trading_card.tcgdex_extras.illustrator}
              </Text>
            )}
            {response.trading_card.tcgdex_extras.types && response.trading_card.tcgdex_extras.types.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">Types:</Text>
                {response.trading_card.tcgdex_extras.types.map((type) => <Badge key={type} size="2xsmall" color="grey">{type}</Badge>)}
              </div>
            )}
          </div>
        )}
      </div>
      {response?.trading_card?.variants.length ? (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Variant</Table.HeaderCell>
              <Table.HeaderCell>Finish / treatment</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>eBay category</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {response.trading_card.variants.map((variant) => (
              <Table.Row key={variant.id}>
                <Table.Cell>
                  <Text size="small">{CARD_CONDITION_LABELS[variant.condition] ?? variant.condition}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {CONDITION_SOURCE_LABELS[variant.condition_source] ?? variant.condition_source}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">
                    {CARD_FINISH_LABELS[variant.finish] ?? variant.finish} {variant.finish_confirmed ? "confirmed" : "review"}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {SPECIAL_TREATMENT_LABELS[variant.special_treatment] ?? variant.special_treatment}{" "}
                    {variant.special_treatment_confirmed ? "confirmed" : "review"}
                  </Text>
                </Table.Cell>
                <Table.Cell><Text size="small">{variant.sku}</Text></Table.Cell>
                <Table.Cell>
                  {variant.ebay_category ? (
                    <Text size="small" title={variant.ebay_category.path}>{variant.ebay_category.path}</Text>
                  ) : (
                    <Text size="small" className="text-ui-fg-muted">Not yet assigned</Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <div className="flex flex-wrap gap-1">
                    <Badge color={variant.price_locked ? "red" : "green"}>{variant.price_locked ? "Price locked" : "Price unlocked"}</Badge>
                    <Badge color={variant.is_high_value_track_individually ? "orange" : "grey"}>
                      {variant.is_high_value_track_individually ? "Individual" : "Grouped"}
                    </Badge>
                    {variant.price_locked && (
                      <Text size="xsmall" className="basis-full text-ui-fg-subtle">
                        {variant.price_locked_actor} · {variant.price_locked_at}
                        {variant.price_lock_reason ? ` · ${variant.price_lock_reason}` : ""}
                      </Text>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : null}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
  id: "holotrail:trading-card",
})

export default TradingCardWidget
