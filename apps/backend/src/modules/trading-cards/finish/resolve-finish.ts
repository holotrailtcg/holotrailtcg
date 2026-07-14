import { CARD_FINISH, type CardFinish } from "../types"

export interface FinishResolution { finish: CardFinish; confirmed: boolean }

export function resolveFinish(raw?: string | null): FinishResolution {
  if (!raw?.trim()) return { finish: CARD_FINISH.OTHER, confirmed: false }
  const value = raw.normalize("NFC").trim().toUpperCase()
  if (["NORMAL", "NON-FOIL", "NON FOIL", "REGULAR"].includes(value)) return { finish: CARD_FINISH.NORMAL, confirmed: true }
  if (value.includes("REVERSE")) return { finish: CARD_FINISH.REVERSE_HOLO, confirmed: true }
  if (value.includes("HOLO") || value === "POKÉ BALL" || value === "POKE BALL" || value === "MASTER BALL") {
    return { finish: CARD_FINISH.HOLO, confirmed: true }
  }
  return { finish: CARD_FINISH.OTHER, confirmed: false }
}
