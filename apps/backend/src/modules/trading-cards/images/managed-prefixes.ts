import { MedusaError } from "@medusajs/framework/utils"

/**
 * The only two R2 key prefixes any cleanup code may ever list or delete
 * within. Spelled exactly once here; `object-keys.ts` and the R2 client's
 * list/delete guards both import these constants rather than re-declaring
 * the strings, so there is a single source of truth for what "managed"
 * means.
 */
export const MANAGED_STAGING_PREFIX = "staging/card-images/"
export const MANAGED_FINAL_PREFIX = "card-images/"

const MANAGED_PREFIXES = [MANAGED_STAGING_PREFIX, MANAGED_FINAL_PREFIX] as const

/** Throws unless `prefix` is exactly one of the two managed-prefix constants. */
export function assertManagedPrefix(prefix: string): string {
  if (!(MANAGED_PREFIXES as readonly string[]).includes(prefix)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cleanup may only list or delete objects within a managed R2 prefix"
    )
  }
  return prefix
}

/**
 * Throws unless `key` is a real descendant of one of the two managed-prefix
 * constants — the prefix itself (e.g. `"card-images/"`) is not a valid key,
 * only something strictly longer that starts with it.
 */
export function assertManagedKey(key: string): string {
  const isManagedDescendant = (MANAGED_PREFIXES as readonly string[]).some(
    (prefix) => key.startsWith(prefix) && key.slice(prefix.length).trim().length > 0
  )
  if (!isManagedDescendant) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cleanup may only delete objects within a managed R2 prefix"
    )
  }
  return key
}
