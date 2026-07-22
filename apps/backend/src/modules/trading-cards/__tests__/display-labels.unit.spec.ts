import {
  CARD_CONDITION, CARD_CONDITION_LABELS, CARD_FINISH, CARD_FINISH_LABELS,
  SPECIAL_TREATMENT, SPECIAL_TREATMENT_LABELS,
} from "../types"

describe("display-label maps", () => {
  it("gives every CardCondition a label, with no gaps", () => {
    for (const value of Object.values(CARD_CONDITION)) {
      expect(CARD_CONDITION_LABELS[value]).toEqual(expect.any(String))
    }
    expect(Object.keys(CARD_CONDITION_LABELS).sort()).toEqual(Object.values(CARD_CONDITION).sort())
  })

  it("gives every CardFinish a label, with no gaps", () => {
    for (const value of Object.values(CARD_FINISH)) {
      expect(CARD_FINISH_LABELS[value]).toEqual(expect.any(String))
    }
    expect(Object.keys(CARD_FINISH_LABELS).sort()).toEqual(Object.values(CARD_FINISH).sort())
  })

  it("gives every SpecialTreatment a label, with no gaps", () => {
    for (const value of Object.values(SPECIAL_TREATMENT)) {
      expect(SPECIAL_TREATMENT_LABELS[value]).toEqual(expect.any(String))
    }
    expect(Object.keys(SPECIAL_TREATMENT_LABELS).sort()).toEqual(Object.values(SPECIAL_TREATMENT).sort())
  })

  it("labels SPECIAL_TREATMENT.NONE as \"None\", never blank or omitted", () => {
    expect(SPECIAL_TREATMENT_LABELS.NONE).toBe("None")
  })

  it("preserves the Poké Ball diacritic in special treatment labels", () => {
    expect(SPECIAL_TREATMENT_LABELS.POKE_BALL).toBe("Poké Ball")
    expect(SPECIAL_TREATMENT_LABELS.POKE_BALL_REVERSE).toBe("Poké Ball Reverse")
  })

  it("uses Title Case, not raw enum keys, for condition labels", () => {
    expect(CARD_CONDITION_LABELS.NEAR_MINT).toBe("Near Mint")
    expect(CARD_CONDITION_LABELS.LIGHTLY_PLAYED).toBe("Lightly Played")
    expect(CARD_CONDITION_LABELS.MODERATELY_PLAYED).toBe("Moderately Played")
    expect(CARD_CONDITION_LABELS.HEAVILY_PLAYED).toBe("Heavily Played")
  })
})
