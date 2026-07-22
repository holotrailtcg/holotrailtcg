import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"
import type TradingCardsModuleService from "../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../modules/trading-card-inventory/service"

/**
 * Read-only diagnostic: dumps the raw snapshot-entry, match, tcgdex
 * candidate and proposal state for one card name within a snapshot, to
 * explain UI states (e.g. "appearing in Step 3 without being approved")
 * without guessing.
 *
 * Usage:
 *   $env:TCI_INSPECT_SNAPSHOT_ID = "tcisnap_..."
 *   $env:TCI_INSPECT_CARD_NAME = "Dottler"
 *   pnpm exec medusa exec ./src/scripts/inspect-snapshot-entry-state.ts
 */
export default async function inspectSnapshotEntryState({ container }: { container: MedusaContainer }) {
  const snapshotId = process.env.TCI_INSPECT_SNAPSHOT_ID?.trim()
  const cardName = process.env.TCI_INSPECT_CARD_NAME?.trim()
  if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_INSPECT_SNAPSHOT_ID is required")
  if (!cardName) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_INSPECT_CARD_NAME is required")

  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const manager = (inventory as unknown as { manager_: { execute: (sql: string, params: unknown[]) => Promise<unknown[]> } }).manager_

  const entries = await manager.execute(
    `select e.id, e.provider_reference, m.matching_status, m.matched_via, e.trading_card_variant_id as entry_variant_id, m.trading_card_variant_id as match_variant_id
       from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id
       where e.inventory_snapshot_id = ? and e.deleted_at is null`,
    [snapshotId],
  )

  const proposals = await manager.execute(
    `select id, provider_reference, change_kind, review_status, trading_card_variant_id, card_creation_claim_token, card_creation_claimed_at
       from trading_card_inventory_proposal
       where inventory_snapshot_id = ? and deleted_at is null`,
    [snapshotId],
  )

  const matchingCards = await cards.listTradingCards({ name: cardName }, { take: 5 })
  const cardIds = matchingCards.map((c) => c.id)
  const variants = cardIds.length > 0
    ? await cards.listTradingCardVariants({ trading_card_id: cardIds }, { take: 20 })
    : []

  console.log(JSON.stringify({
    cardNameSearched: cardName,
    matchingTradingCards: matchingCards,
    variants,
    entries,
    proposals,
  }, null, 2))
}
