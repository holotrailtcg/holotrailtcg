import type { MedusaContainer } from "@medusajs/framework/types"
import { asValue } from "@medusajs/framework/awilix"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveR2Config } from "../../../modules/trading-cards/images/r2-config"
import { createR2ImageStorageClient, type R2ImageStorageClient } from "../../../modules/trading-cards/images/r2-client"

/**
 * Container registration key for the R2 image storage client used by the
 * upload/confirm routes. There is no Medusa module for this adapter, so it
 * follows the same lazy-registration pattern as
 * `src/api/admin/tcgdex/dependencies.ts`: nothing registers this key at
 * application boot, so the first real request constructs the real
 * `R2ImageStorageClient` (which resolves `R2_*` env vars via
 * `resolveR2Config`) and caches it on the container. HTTP integration tests
 * register a fake under this same key immediately after the app boots,
 * before any request is made, so the real client and its real network calls
 * are never constructed during those tests.
 */
export const R2_IMAGE_STORAGE_CLIENT_KEY = "r2ImageStorageClient"

export function resolveR2ImageStorageClient(container: MedusaContainer): R2ImageStorageClient {
  if (!container.hasRegistration(R2_IMAGE_STORAGE_CLIENT_KEY)) {
    const config = resolveR2Config()
    if (!config.enabled) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Card image uploads are not enabled in this environment")
    }
    container.register(R2_IMAGE_STORAGE_CLIENT_KEY, asValue(createR2ImageStorageClient(config)))
  }
  return container.resolve<R2ImageStorageClient>(R2_IMAGE_STORAGE_CLIENT_KEY)
}
