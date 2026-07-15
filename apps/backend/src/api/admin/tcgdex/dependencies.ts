import type { MedusaContainer } from "@medusajs/framework/types"
import { asValue } from "@medusajs/framework/awilix"
import { TcgDexClient, type TcgDexLookupDependency } from "../../../modules/trading-cards/tcgdex"

/**
 * Container registration key for the TCGdex lookup client used by the
 * retry action. There is no Medusa module for this adapter, so it follows
 * the same lazy-registration pattern as
 * `src/api/store/newsletter/shared/dependencies.ts`: nothing registers
 * this key at application boot, so the first real retry request
 * constructs the real `TcgDexClient` (which resolves `TCGDEX_*` env vars)
 * and caches it on the container. HTTP integration tests register a fake
 * under this same key immediately after the app boots, before any request
 * is made, so the real client and its real network calls are never
 * constructed during those tests.
 */
export const TCGDEX_ADMIN_CLIENT_KEY = "tcgdexAdminClient"

export function resolveTcgDexAdminClient(container: MedusaContainer): TcgDexLookupDependency {
  if (!container.hasRegistration(TCGDEX_ADMIN_CLIENT_KEY)) {
    container.register(TCGDEX_ADMIN_CLIENT_KEY, asValue(new TcgDexClient()))
  }
  return container.resolve<TcgDexLookupDependency>(TCGDEX_ADMIN_CLIENT_KEY)
}
