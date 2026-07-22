import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"

/**
 * One-off cleanup: deletes draft Products titled "Dottler" or "Snom" that
 * have no trading_card module link — the exact orphan shape
 * `create-card-from-inventory-row.ts` documents as its accepted residual
 * when a create attempt fails after the Product step but before the link
 * step (see ADR 0013, "Deferred: orphan reconciliation"). Refuses to touch
 * any product that does have a trading_card link, no matter its title.
 *
 * Usage:
 *   pnpm exec medusa exec ./src/scripts/delete-orphan-trading-card-products.ts
 */
export default async function deleteOrphanTradingCardProducts({ container }: { container: MedusaContainer }) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)

  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "trading_card.id"],
    filters: { title: ["Dottler", "Snom"] },
  })

  const orphanIds = (data as Array<{ id: string; title: string; status: string; trading_card?: { id?: string } | null }>)
    .filter((product) => !product.trading_card?.id)
    .map((product) => product.id)

  if (orphanIds.length === 0) {
    console.log(JSON.stringify({ deletedCount: 0, message: "No unlinked Dottler/Snom products found." }))
    return
  }

  await products.deleteProducts(orphanIds)
  console.log(JSON.stringify({ deletedCount: orphanIds.length, deletedIds: orphanIds }))
}
