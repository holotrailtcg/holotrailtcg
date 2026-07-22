/**
 * Mirrors `CARD_CONDITION` / `CARD_FINISH` / `SPECIAL_TREATMENT` in
 * `src/modules/trading-cards/types.ts` exactly. Admin route code is bundled
 * separately from backend module code in this app, so the values are kept
 * here rather than imported — update both places together if the backend
 * enum changes.
 */

export interface DimensionOption {
  value: string
  label: string
}

export const CONDITION_OPTIONS: DimensionOption[] = [
  { value: "NEAR_MINT", label: "Near Mint" },
  { value: "LIGHTLY_PLAYED", label: "Lightly Played" },
  { value: "MODERATELY_PLAYED", label: "Moderately Played" },
  { value: "HEAVILY_PLAYED", label: "Heavily Played" },
  { value: "DAMAGED", label: "Damaged" },
]

export const FINISH_OPTIONS: DimensionOption[] = [
  { value: "NORMAL", label: "Normal" },
  { value: "HOLO", label: "Holo" },
  { value: "REVERSE_HOLO", label: "Reverse Holo" },
  { value: "OTHER", label: "Other" },
]

export const SPECIAL_TREATMENT_OPTIONS: DimensionOption[] = [
  { value: "NONE", label: "None" },
  { value: "ENERGY_REVERSE", label: "Energy Reverse" },
  { value: "POKE_BALL_REVERSE", label: "Poke Ball Reverse" },
  { value: "MASTER_BALL_REVERSE", label: "Master Ball Reverse" },
  { value: "LOVE_BALL_REVERSE", label: "Love Ball Reverse" },
  { value: "QUICK_BALL_REVERSE", label: "Quick Ball Reverse" },
  { value: "FRIEND_BALL_REVERSE", label: "Friend Ball Reverse" },
  { value: "DUSK_BALL_REVERSE", label: "Dusk Ball Reverse" },
  { value: "ROCKET_REVERSE", label: "Rocket Reverse" },
  { value: "POKE_BALL", label: "Poke Ball" },
  { value: "MASTER_BALL", label: "Master Ball" },
  { value: "STARLIGHT_HOLO", label: "Starlight Holo" },
  { value: "COSMOS_HOLO", label: "Cosmos Holo" },
  { value: "TINSEL_HOLO", label: "Tinsel Holo" },
  { value: "GALAXY_HOLO", label: "Galaxy Holo" },
  { value: "CRACKED_ICE", label: "Cracked Ice" },
  { value: "STAMPED", label: "Stamped" },
  { value: "PRERELEASE_STAMPED", label: "Prerelease Stamped" },
  { value: "PROMOTIONAL_STAMPED", label: "Promotional Stamped" },
  { value: "TEXTURED", label: "Textured" },
  { value: "ETCHED", label: "Etched" },
  { value: "OTHER", label: "Other" },
]

export function dimensionLabel(options: DimensionOption[], value: string | null): string {
  return options.find((option) => option.value === value)?.label ?? value ?? "—"
}
