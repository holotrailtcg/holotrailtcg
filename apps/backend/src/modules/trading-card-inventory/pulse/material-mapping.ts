import { INVENTORY_CARD_FINISH as FINISH, INVENTORY_SPECIAL_TREATMENT as TREATMENT } from "../types"
import type { MaterialCandidate } from "./types"

/**
 * Controlled mapping from Pulse's free-text `Material` column to Stage 3's
 * closed finish/special-treatment taxonomy. Blank material is deliberately
 * left unrecognised rather than assumed `NORMAL` — Stage 3 requires an
 * explicit confirmation before a variant is recorded as `NORMAL` finish,
 * and this importer never creates variants, so a blank/ambiguous material
 * always routes to review rather than guessing "no special treatment."
 * Unrecognised material strings are never folded into an existing enum
 * value or used to invent a new one.
 */
const MATERIAL_MAP: Record<string, { finish: string; treatment: string }> = {
  "holo": { finish: FINISH.HOLO, treatment: TREATMENT.NONE },
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
  if (!trimmed) return { finishCandidate: null, specialTreatmentCandidate: null, recognized: false }
  const mapped = MATERIAL_MAP[trimmed.toLowerCase()]
  if (!mapped) return { finishCandidate: null, specialTreatmentCandidate: null, recognized: false }
  return { finishCandidate: mapped.finish, specialTreatmentCandidate: mapped.treatment, recognized: true }
}
