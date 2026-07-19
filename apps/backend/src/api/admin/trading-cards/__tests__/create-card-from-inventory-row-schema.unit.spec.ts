import { createCardFromInventoryRowBodySchema, parseAdminInput } from "../shared"

// Service-level coverage for the Zod schema `POST
// /admin/trading-cards/create-from-inventory-row` parses request bodies
// through — the same enforcement the route relies on, exercised directly
// here (no HTTP/DB round-trip) so the exact accept/reject boundary is
// pinned down independently of the DB-backed HTTP suite in
// `integration-tests/http/newsletter.spec.ts`.
describe("createCardFromInventoryRowBodySchema", () => {
  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      inventoryProposalId: "tciprop_1",
      cardSetDisplayName: "Test Set",
      name: "Test Card",
      cardNumber: "066/196",
      rarityRaw: null,
      condition: "NEAR_MINT",
      finish: "HOLO",
      specialTreatment: "NONE",
      finishConfirmed: true,
      specialTreatmentConfirmed: true,
      ...overrides,
    }
  }

  it("accepts a fully confirmed, well-formed body", () => {
    expect(createCardFromInventoryRowBodySchema.parse(validBody())).toMatchObject(validBody())
  })

  it.each([
    ["finishConfirmed: false", { finishConfirmed: false }],
    ["finishConfirmed: \"true\" (string, not boolean)", { finishConfirmed: "true" }],
    ["specialTreatmentConfirmed: false", { specialTreatmentConfirmed: false }],
    ["specialTreatmentConfirmed: 1 (truthy, not boolean)", { specialTreatmentConfirmed: 1 }],
  ])("rejects a body with %s", (_label, overrides) => {
    expect(createCardFromInventoryRowBodySchema.safeParse(validBody(overrides)).success).toBe(false)
  })

  it("rejects a body that omits finishConfirmed entirely", () => {
    const body = validBody() as Record<string, unknown>
    delete body.finishConfirmed
    expect(createCardFromInventoryRowBodySchema.safeParse(body).success).toBe(false)
  })

  it("rejects a body that omits specialTreatmentConfirmed entirely", () => {
    const body = validBody() as Record<string, unknown>
    delete body.specialTreatmentConfirmed
    expect(createCardFromInventoryRowBodySchema.safeParse(body).success).toBe(false)
  })

  it.each([
    "1 2", "12/34/56", "025ab", "025/ab", "", "  ",
  ])("rejects a malformed cardNumber %j", (cardNumber) => {
    expect(createCardFromInventoryRowBodySchema.safeParse(validBody({ cardNumber })).success).toBe(false)
  })

  it.each(["001", "0104", "066/196", "025a", "SWSH123", "1/1"])("accepts a well-formed cardNumber %s", (cardNumber) => {
    expect(createCardFromInventoryRowBodySchema.safeParse(validBody({ cardNumber })).success).toBe(true)
  })

  it("rejects unknown extra fields (strict schema)", () => {
    expect(createCardFromInventoryRowBodySchema.safeParse(validBody({ extra: "nope" })).success).toBe(false)
  })

  it("parseAdminInput collapses every schema failure to a generic 400-shaped MedusaError, never leaking which field failed", () => {
    expect(() => parseAdminInput(createCardFromInventoryRowBodySchema, validBody({ finishConfirmed: false })))
      .toThrow("The request parameters are invalid.")
  })
})
