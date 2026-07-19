/**
 * Turns a domain enum value like "REVERSE_HOLO" or "DUSK_BALL_REVERSE" into a
 * human-readable label ("Reverse Holo", "Dusk Ball Reverse") for display in
 * Admin tables. Never used for values already meant to stay verbatim (e.g. a
 * provider reference string).
 */
export function formatEnumLabel(value: string | null | undefined): string {
  if (!value) return "—"
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
