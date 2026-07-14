import { createHash } from "node:crypto"
import type { CardCondition, CardFinish, SpecialTreatment } from "../types"
import { machineSegment } from "./slugify"

const CONDITION_CODES: Record<CardCondition, string> = {
  NEAR_MINT: "NM", LIGHTLY_PLAYED: "LP", MODERATELY_PLAYED: "MP", HEAVILY_PLAYED: "HP", DAMAGED: "DM",
}
const FINISH_CODES: Record<CardFinish, string> = { NORMAL: "N", HOLO: "H", REVERSE_HOLO: "R", OTHER: "X" }
const TREATMENT_CODES: Record<SpecialTreatment, string> = {
  NONE: "0", ENERGY_REVERSE: "ER", POKE_BALL_REVERSE: "PBR", MASTER_BALL_REVERSE: "MBR",
  LOVE_BALL_REVERSE: "LBR", QUICK_BALL_REVERSE: "QBR", FRIEND_BALL_REVERSE: "FBR",
  DUSK_BALL_REVERSE: "DBR", ROCKET_REVERSE: "RR", POKE_BALL: "PB", MASTER_BALL: "MB",
  STARLIGHT_HOLO: "SH", COSMOS_HOLO: "CH", GALAXY_HOLO: "GH", CRACKED_ICE: "CI",
  STAMPED: "ST", PRERELEASE_STAMPED: "PRS", PROMOTIONAL_STAMPED: "PMS", TEXTURED: "TX",
  ETCHED: "ET", OTHER: "X",
}

export interface GenerateSkuInput {
  tradingCardId: string
  game: string
  language: string
  setCode: string
  cardNumber: string
  cardName: string
  condition: CardCondition
  finish: CardFinish
  specialTreatment: SpecialTreatment
}

export function generateSku(input: GenerateSkuInput): string {
  const hash = createHash("sha256")
    .update(`${input.tradingCardId}|${input.condition}|${input.finish}|${input.specialTreatment}`)
    .digest("hex").slice(0, 8).toUpperCase()
  const commercial = `${CONDITION_CODES[input.condition]}${FINISH_CODES[input.finish]}${TREATMENT_CODES[input.specialTreatment]}`
  const readable = [input.game, input.language, input.setCode, input.cardNumber, input.cardName]
    .map((value) => machineSegment(value) || "X")
  const tail = `${commercial}-${hash}`
  const readableBudget = 128 - tail.length - readable.length
  let overflow = readable.reduce((total, segment) => total + segment.length, 0) - readableBudget
  for (const index of [4, 3, 2, 1, 0]) {
    if (overflow <= 0) break
    const removable = Math.min(overflow, readable[index].length - 1)
    readable[index] = readable[index].slice(0, readable[index].length - removable).replace(/[_-]+$/g, "") || "X"
    overflow -= removable
  }
  return `${readable.join("-")}-${tail}`
}
