import { VERIFIED_PULSE_ROWS } from "../../__fixtures__/pulse-rows"
import { resolveFinish } from "../resolve-finish"
import { resolveSpecialTreatment } from "../resolve-special-treatment"

describe("finish resolution", () => {
  it("confirms explicit Holo and Reverse Holo", () => {
    expect(resolveFinish("Holo")).toEqual({ finish: "HOLO", confirmed: true })
    expect(resolveFinish("Reverse Holo")).toEqual({ finish: "REVERSE_HOLO", confirmed: true })
  })

  it("does not silently turn missing material into Normal", () => {
    expect(resolveFinish(VERIFIED_PULSE_ROWS.missingMaterial.material)).toEqual({ finish: "OTHER", confirmed: false })
  })

  it("makes unknown finish input reviewable", () => {
    expect(resolveFinish("Mystery foil")).toEqual({ finish: "OTHER", confirmed: false })
  })
})

describe("special-treatment resolution", () => {
  it("resolves verified Chinese treatments", () => {
    expect(resolveSpecialTreatment(VERIFIED_PULSE_ROWS.chinesePokeBall.material)).toEqual({
      specialTreatment: "POKE_BALL", confirmed: true,
    })
    expect(resolveSpecialTreatment(VERIFIED_PULSE_ROWS.chineseStarlight.material)).toEqual({
      specialTreatment: "STARLIGHT_HOLO", confirmed: true,
    })
  })

  it("confirms absence for ordinary known materials", () => {
    expect(resolveSpecialTreatment("Reverse Holo")).toEqual({ specialTreatment: "NONE", confirmed: true })
  })

  it("makes unknown treatments reviewable", () => {
    expect(resolveSpecialTreatment("Rainbow spiral")).toEqual({ specialTreatment: "OTHER", confirmed: false })
  })
})
