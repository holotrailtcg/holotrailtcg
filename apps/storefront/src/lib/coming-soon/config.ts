/**
 * `COMING_SOON_MODE` is deliberately not `NEXT_PUBLIC_`-prefixed: it only
 * needs to be read server-side (in `middleware.ts`), never in the browser
 * bundle. Only the exact strings "true"/"false" change the outcome — any
 * other value (unset, "TRUE", "1", "", a typo) fails closed and gates the
 * store, since an unfinished store must never be exposed by an unset or
 * mistyped variable.
 */
export function resolveComingSoonMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.COMING_SOON_MODE
  if (raw === "false") {
    return false
  }
  if (raw === "true") {
    return true
  }
  return true
}
