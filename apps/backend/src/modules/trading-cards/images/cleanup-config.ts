export type CleanupEnvironment = Record<string, string | undefined>

/**
 * Stage 4B.4 Slice 2: fail-safe in the *opposite* direction from
 * `R2_IMAGES_ENABLED` (`r2-config.ts`) — here the safe default is "on"
 * (dry-run), so unset, empty, or malformed values never let a mistyped
 * environment variable turn on real R2 deletion. Only the exact,
 * case-sensitive string `"false"` disables dry-run.
 */
export function resolveCardImageCleanupDryRun(env: CleanupEnvironment = process.env): boolean {
  return env.CARD_IMAGE_CLEANUP_DRY_RUN !== "false"
}
