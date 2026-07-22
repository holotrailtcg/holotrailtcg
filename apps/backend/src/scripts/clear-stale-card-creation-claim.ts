import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../modules/trading-card-inventory/service"

/**
 * KEEP — reusable ops tool, not a diagnostic. `create-card-from-inventory-row.ts`
 * deliberately has no in-workflow compensation for a failed card-creation
 * attempt — recovery is by the claim's 5-minute lease expiring on its own
 * (see that file's own doc comment). That design choice means a genuinely
 * failed attempt (e.g. the missing-stock-location bug hit 2026-07-21/22)
 * will recur in some form eventually, and this is the sanctioned way to
 * unstick it early rather than wait. Already scoped to one provider
 * reference, only touches a row with a live claim, and refuses to act on
 * an ambiguous match — do not delete as "unsafe", it already has the
 * guardrails a safe mutation script needs.
 *
 * One-off operational unstick: clears a proposal's card-creation claim early
 * instead of waiting for its 5-minute lease to expire. Only ever touches a
 * proposal that currently holds a live claim token — never a resolved or
 * unclaimed row. Refuses to act if the reference matches more than one live
 * claim, rather than guessing which one is meant.
 *
 * Usage:
 *   $env:TCI_CLAIM_PROVIDER_REFERENCE = "card:sv5|168/162|null|null|null|null"
 *   pnpm exec medusa exec ./src/scripts/clear-stale-card-creation-claim.ts
 */
export default async function clearStaleCardCreationClaim({ container }: { container: MedusaContainer }) {
  const providerReference = process.env.TCI_CLAIM_PROVIDER_REFERENCE?.trim()
  if (!providerReference) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_CLAIM_PROVIDER_REFERENCE is required")

  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const manager = (inventory as unknown as { manager_: { execute: (sql: string, params: unknown[]) => Promise<unknown[]> } }).manager_

  const live = await manager.execute(
    `select id, inventory_snapshot_id, card_creation_claim_token, card_creation_claimed_at
       from trading_card_inventory_proposal
       where provider_reference = ? and card_creation_claim_token is not null and deleted_at is null`,
    [providerReference],
  )
  if (live.length === 0) {
    console.log(JSON.stringify({ clearedRows: [], message: "No live claim found for this reference — nothing to clear." }))
    return
  }
  if (live.length > 1) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `${live.length} proposals share this provider_reference with a live claim — refusing to guess which to clear.`)
  }

  const rows = await manager.execute(
    `update trading_card_inventory_proposal
       set card_creation_claim_token = null, card_creation_claimed_at = null, updated_at = now()
       where provider_reference = ? and card_creation_claim_token is not null and deleted_at is null
       returning id, provider_reference`,
    [providerReference],
  )

  console.log(JSON.stringify({ clearedRows: rows }))
}
