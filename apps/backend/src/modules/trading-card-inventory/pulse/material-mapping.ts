import { INVENTORY_CARD_FINISH as FINISH, INVENTORY_SPECIAL_TREATMENT as TREATMENT } from "../types"
import type { MaterialCandidate } from "./types"

/**
 * Controlled mapping from Pulse's free-text `Material` column to Stage 3's
 * closed finish/special-treatment taxonomy. Blank material means Normal /
 * no special treatment (Pulse omits the column entirely for ordinary
 * non-holo cards rather than emitting an explicit "Non-holo" string) — see
 * `mapMaterial` below. Unrecognised *non-blank* material strings are never
 * folded into an existing enum value or used to invent a new one; they stay
 * unrecognised and route to review.
 */
const MATERIAL_MAP: Record<string, { finish: string; treatment: string }> = {
  "non-holo": { finish: FINISH.NORMAL, treatment: TREATMENT.NONE },
  "holo": { finish: FINISH.HOLO, treatment: TREATMENT.NONE },
  "cosmos holo": { finish: FINISH.HOLO, treatment: TREATMENT.COSMOS_HOLO },
  "tinsel holo": { finish: FINISH.HOLO, treatment: TREATMENT.TINSEL_HOLO },
  "reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.NONE },
  "energy reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.ENERGY_REVERSE },
  "poké ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.POKE_BALL_REVERSE },
  "poke ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.POKE_BALL_REVERSE },
  "master ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.MASTER_BALL_REVERSE },
  "love ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.LOVE_BALL_REVERSE },
  "quick ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.QUICK_BALL_REVERSE },
  "friend ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.FRIEND_BALL_REVERSE },
  "dusk ball reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.DUSK_BALL_REVERSE },
  "rocket reverse holo": { finish: FINISH.REVERSE_HOLO, treatment: TREATMENT.ROCKET_REVERSE },
  "poké ball": { finish: FINISH.NORMAL, treatment: TREATMENT.POKE_BALL },
  "poke ball": { finish: FINISH.NORMAL, treatment: TREATMENT.POKE_BALL },
  "master ball": { finish: FINISH.NORMAL, treatment: TREATMENT.MASTER_BALL },
  "starlight holo": { finish: FINISH.HOLO, treatment: TREATMENT.STARLIGHT_HOLO },
}

export function mapMaterial(rawMaterial: string | null | undefined): MaterialCandidate {
  const trimmed = (rawMaterial ?? "").trim()
  if (!trimmed) return { finishCandidate: FINISH.NORMAL, specialTreatmentCandidate: TREATMENT.NONE, recognized: true }
  const mapped = MATERIAL_MAP[trimmed.toLowerCase()]
  if (!mapped) return { finishCandidate: null, specialTreatmentCandidate: null, recognized: false }
  return { finishCandidate: mapped.finish, specialTreatmentCandidate: mapped.treatment, recognized: true }
}
