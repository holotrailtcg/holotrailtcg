import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { CARD_CONDITION_LABELS, CARD_FINISH_LABELS, type CardCondition, type CardFinish } from "../../modules/trading-cards/types"

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
  name: string
  card_number: string
  rarity_raw: string | null
  rarity: string | null
  medusa_product_id: string | null
  card_set: { display_name: string; language: string }
  tcgdex_extras: TcgdexExtrasView | null
  variant: {
    condition: CardCondition
    finish: CardFinish
    special_treatment: string
    sku: string
    ebay_category: EbayCategoryView | null
  }
}

interface WidgetProps { data: { id: string } }

const TradingCardInventoryItemWidget = ({ data }: WidgetProps) => {
  const { data: response, isLoading, isError } = useQuery({
    queryKey: ["trading-card-by-inventory-item", data.id],
    queryFn: async (): Promise<{ trading_card: TradingCardView | null }> => {
      const result = await fetch(`/admin/trading-cards/by-inventory-item/${encodeURIComponent(data.id)}`, {
        credentials: "include",
      })
      if (!result.ok) throw new Error("Unable to load trading-card details")
      return result.json()
    },
  })

  if (!isLoading && !isError && !response?.trading_card) return null

  const card = response?.trading_card

  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Trading card</Heading>
        {isLoading && <Text size="small" className="text-ui-fg-subtle">Loading trading-card details…</Text>}
        {isError && <Text size="small" className="text-ui-fg-error">Trading-card details could not be loaded.</Text>}
        {card && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-ui-fg-subtle">
            <Text size="small">{card.name}</Text>
            <Text size="small">{card.card_set.display_name}</Text>
            <Text size="small">{card.card_set.language}</Text>
            <Text size="small">Card number: {card.card_number}</Text>
            <Text size="small">Rarity: {card.rarity ?? card.rarity_raw ?? "Unmapped"}</Text>
            <Text size="small">
              {CARD_CONDITION_LABELS[card.variant.condition] ?? card.variant.condition} ·{" "}
              {CARD_FINISH_LABELS[card.variant.finish] ?? card.variant.finish}
            </Text>
            <Text size="small" className="col-span-2">
              eBay category: {card.variant.ebay_category?.path ?? <span className="text-ui-fg-muted">Not yet assigned</span>}
            </Text>
            {card.medusa_product_id && (
              <Text size="small" className="col-span-2">
                <Link to={`/products/${encodeURIComponent(card.medusa_product_id)}`} className="text-ui-fg-interactive underline">
                  View product
                </Link>
              </Text>
            )}
          </div>
        )}
        {card?.tcgdex_extras && (
          <div className="mt-4 flex flex-col gap-2">
            <Text size="small" weight="plus">TCGdex reference data</Text>
            {card.tcgdex_extras.variants && (
              <div className="flex flex-wrap items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">Available finishes:</Text>
                {(Object.entries(card.tcgdex_extras.variants) as Array<[keyof typeof TCGDEX_VARIANT_LABELS, boolean]>)
                  .filter(([, present]) => present)
                  .map(([key]) => <Badge key={key} size="2xsmall">{TCGDEX_VARIANT_LABELS[key]}</Badge>)}
              </div>
            )}
            {card.tcgdex_extras.illustrator && (
              <Text size="small" className="text-ui-fg-subtle">Illustrator: {card.tcgdex_extras.illustrator}</Text>
            )}
            {card.tcgdex_extras.types && card.tcgdex_extras.types.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">Types:</Text>
                {card.tcgdex_extras.types.map((type) => <Badge key={type} size="2xsmall" color="grey">{type}</Badge>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "inventory_item.details.before",
  id: "holotrail:trading-card-inventory-item",
})

export default TradingCardInventoryItemWidget
