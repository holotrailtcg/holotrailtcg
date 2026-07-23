import { resolveCondition } from "../condition"
import { inferProviderLanguageHint, resolveRowLanguage } from "../language"
import { mapMaterial } from "../material-mapping"
import { mapRarity } from "../rarity-mapping"
import { INVENTORY_CARD_CONDITION, INVENTORY_CARD_FINISH, INVENTORY_SPECIAL_TREATMENT, INVENTORY_RARITY, INVENTORY_SOURCE_LANGUAGE } from "../../types"

describe("resolveCondition", () => {
  it("defaults to Near Mint with DEFAULTED provenance when no token is present", () => {
    expect(resolveCondition(null)).toEqual({ condition: INVENTORY_CARD_CONDITION.NEAR_MINT, source: "DEFAULTED", unknownToken: null })
  })

  it("maps a trusted token explicitly", () => {
    expect(resolveCondition("lp")).toEqual({ condition: INVENTORY_CARD_CONDITION.LIGHTLY_PLAYED, source: "EXPLICIT", unknownToken: null })
  })

  it("sends an unrecognised token to review rather than silently treating it as Near Mint", () => {
    const result = resolveCondition("mint")
    expect(result.source).toBe("DEFAULTED")
    expect(result.unknownToken).toBe("mint")
  })

  it("maps all four tokens Pulse actually emits", () => {
    expect(resolveCondition("NM").condition).toBe(INVENTORY_CARD_CONDITION.NEAR_MINT)
    expect(resolveCondition("LP").condition).toBe(INVENTORY_CARD_CONDITION.LIGHTLY_PLAYED)
    expect(resolveCondition("MP").condition).toBe(INVENTORY_CARD_CONDITION.MODERATELY_PLAYED)
    expect(resolveCondition("HP").condition).toBe(INVENTORY_CARD_CONDITION.HEAVILY_PLAYED)
  })

  it("does not recognise dmg/dm — Pulse has no Damaged token", () => {
    expect(resolveCondition("dmg").unknownToken).toBe("dmg")
    expect(resolveCondition("dm").unknownToken).toBe("dm")
  })
})

describe("language resolution", () => {
  it("infers _jp and _scn provider hints", () => {
    expect(inferProviderLanguageHint("s8b_jp")).toBe(INVENTORY_SOURCE_LANGUAGE.JA)
    expect(inferProviderLanguageHint("cbb2_scn")).toBe(INVENTORY_SOURCE_LANGUAGE.ZH)
    expect(inferProviderLanguageHint("swsh4pt5")).toBeNull()
  })

  it("keeps the source language authoritative and flags a conflicting hint rather than overriding it", () => {
    const result = resolveRowLanguage(INVENTORY_SOURCE_LANGUAGE.JA, null)
    expect(result).toEqual({ language: INVENTORY_SOURCE_LANGUAGE.JA, conflict: false, hint: null })

    const conflicting = resolveRowLanguage(INVENTORY_SOURCE_LANGUAGE.JA, null) // no hint case
    expect(conflicting.conflict).toBe(false)

    const realConflict = resolveRowLanguage(INVENTORY_SOURCE_LANGUAGE.JA, INVENTORY_SOURCE_LANGUAGE.ZH)
    expect(realConflict).toEqual({ language: INVENTORY_SOURCE_LANGUAGE.JA, conflict: true, hint: INVENTORY_SOURCE_LANGUAGE.ZH })
  })

  it("falls back to the hint only when the source has no fixed language", () => {
    expect(resolveRowLanguage(null, INVENTORY_SOURCE_LANGUAGE.JA)).toEqual({ language: INVENTORY_SOURCE_LANGUAGE.JA, conflict: false, hint: INVENTORY_SOURCE_LANGUAGE.JA })
    expect(resolveRowLanguage(null, null)).toEqual({ language: null, conflict: false, hint: null })
  })
})

describe("mapMaterial", () => {
  it("maps a known reverse-holo special-treatment material", () => {
    expect(mapMaterial("Poké Ball Reverse Holo")).toEqual({
      finishCandidate: INVENTORY_CARD_FINISH.REVERSE_HOLO, specialTreatmentCandidate: INVENTORY_SPECIAL_TREATMENT.POKE_BALL_REVERSE, recognized: true,
    })
  })

  it("maps plain Holo and Reverse Holo", () => {
    expect(mapMaterial("Holo").finishCandidate).toBe(INVENTORY_CARD_FINISH.HOLO)
    expect(mapMaterial("Reverse Holo").finishCandidate).toBe(INVENTORY_CARD_FINISH.REVERSE_HOLO)
  })

  it("maps blank material to Normal finish with no special treatment", () => {
    expect(mapMaterial("")).toEqual({ finishCandidate: INVENTORY_CARD_FINISH.NORMAL, specialTreatmentCandidate: INVENTORY_SPECIAL_TREATMENT.NONE, recognized: true })
    expect(mapMaterial(undefined)).toEqual({ finishCandidate: INVENTORY_CARD_FINISH.NORMAL, specialTreatmentCandidate: INVENTORY_SPECIAL_TREATMENT.NONE, recognized: true })
    expect(mapMaterial(null)).toEqual({ finishCandidate: INVENTORY_CARD_FINISH.NORMAL, specialTreatmentCandidate: INVENTORY_SPECIAL_TREATMENT.NONE, recognized: true })
  })

  it("maps Cosmos Holo to Holo finish with the Cosmos Holo special treatment", () => {
    expect(mapMaterial("Cosmos Holo")).toEqual({ finishCandidate: INVENTORY_CARD_FINISH.HOLO, specialTreatmentCandidate: INVENTORY_SPECIAL_TREATMENT.COSMOS_HOLO, recognized: true })
  })

  it("maps Tinsel Holo to Holo finish with the Tinsel Holo special treatment", () => {
    expect(mapMaterial("Tinsel Holo")).toEqual({ finishCandidate: INVENTORY_CARD_FINISH.HOLO, specialTreatmentCandidate: INVENTORY_SPECIAL_TREATMENT.TINSEL_HOLO, recognized: true })
  })

  it("never invents a new enum value for an unrecognised, non-blank material string", () => {
    expect(mapMaterial("Some Unheard-Of Finish")).toEqual({ finishCandidate: null, specialTreatmentCandidate: null, recognized: false })
  })
})

describe("mapRarity", () => {
  it("maps unambiguous rarities", () => {
    expect(mapRarity("Common").candidate).toBe(INVENTORY_RARITY.COMMON)
    expect(mapRarity("Uncommon").candidate).toBe(INVENTORY_RARITY.UNCOMMON)
    expect(mapRarity("Double Rare (RR)").candidate).toBe(INVENTORY_RARITY.DOUBLE_RARE)
  })

  it("leaves Unknown, blank and unrecognised game-specific labels pending review", () => {
    expect(mapRarity("Unknown")).toEqual({ candidate: null, raw: "Unknown" })
    expect(mapRarity("Holo Rare V")).toEqual({ candidate: null, raw: "Holo Rare V" })
    expect(mapRarity("")).toEqual({ candidate: null, raw: null })
  })
})
