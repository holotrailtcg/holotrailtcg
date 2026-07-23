import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"

/**
 * Stage 1: manual local correction — illustrator confirm-lock behaviour.
 * NOT RUN this session — no approved, isolated test database connection
 * was available (see the Stage 1 continuation report). Run with
 * `npm run test:integration:modules` against the project's approved test
 * database before merging.
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

async function cardFixture() {
  const id = suffix()
  const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${id}`, provider_set_code: `set_${id}` })
  return cards.createTradingCards({
    card_set_id: set.id, name: `Illustrator Card ${id}`, search_name: `illustrator card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
}

describe("updateTradingCardIdentity — illustrator confirm-lock", () => {
  it("applies an unconfirmed illustrator update while none is confirmed yet", async () => {
    const card = await cardFixture()
    const updated = await cards.updateTradingCardIdentity({
      id: card.id, actor: "system", source: "TCGDEX", illustrator: "Mitsuhiro Arita",
    })
    expect(updated.illustrator).toBe("Mitsuhiro Arita")
    expect(updated.illustrator_confirmed).toBe(false)
  })

  it("locks the illustrator once explicitly confirmed, and ignores a later unapproved value", async () => {
    const card = await cardFixture()
    await cards.updateTradingCardIdentity({
      id: card.id, actor: "reviewer-1", source: "MANUAL", illustrator: "Ken Sugimori", illustratorConfirmed: true,
    })

    const afterUnapproved = await cards.updateTradingCardIdentity({
      id: card.id, actor: "system", source: "TCGDEX", illustrator: "Some Other Name",
    })
    expect(afterUnapproved.illustrator).toBe("Ken Sugimori")
    expect(afterUnapproved.illustrator_confirmed).toBe(true)
  })

  it("allows a later reviewer to explicitly re-confirm a different illustrator", async () => {
    const card = await cardFixture()
    await cards.updateTradingCardIdentity({
      id: card.id, actor: "reviewer-1", source: "MANUAL", illustrator: "Ken Sugimori", illustratorConfirmed: true,
    })
    const corrected = await cards.updateTradingCardIdentity({
      id: card.id, actor: "reviewer-2", source: "MANUAL", illustrator: "Mitsuhiro Arita", illustratorConfirmed: true,
    })
    expect(corrected.illustrator).toBe("Mitsuhiro Arita")
  })

  it("is optional — a card can be created and updated with no illustrator at all", async () => {
    const card = await cardFixture()
    expect(card.illustrator).toBeNull()
    const updated = await cards.updateTradingCardIdentity({ id: card.id, actor: "reviewer-1", source: "MANUAL", name: "Renamed, no illustrator" })
    expect(updated.illustrator).toBeNull()
    expect(updated.name).toBe("Renamed, no illustrator")
  })

  it("never participates in TradingCard/TradingCardVariant identity — two cards with different illustrators can share every other identity field only if genuinely distinct by (card_set_id, card_number_normalised)", async () => {
    // Illustrator is not part of IDX_trading_card_identity or IDX_trading_card_variant_identity — this
    // asserts the two identity-defining unique constraints, not illustrator, are what govern uniqueness.
    const id = suffix()
    const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${id}`, provider_set_code: `set_${id}` })
    await cards.createTradingCards({
      card_set_id: set.id, name: "Same Card", search_name: "same card",
      card_number: "001", card_number_normalised: "001", origin: "MANUAL", illustrator: "Artist A",
    })
    await expect(cards.createTradingCards({
      card_set_id: set.id, name: "Same Card", search_name: "same card",
      card_number: "001", card_number_normalised: "001", origin: "MANUAL", illustrator: "Artist B",
    })).rejects.toThrow()
  })

  it("audits the identity/illustrator change", async () => {
    const card = await cardFixture()
    await cards.updateTradingCardIdentity({ id: card.id, actor: "reviewer-1", source: "MANUAL", illustrator: "Ken Sugimori", illustratorConfirmed: true })
    const [audit] = (await pgConnection.raw(
      `select * from trading_card_audit_entry where entity_id = ? and action = 'CANONICAL_IDENTITY_CHANGED' order by created_at desc limit 1`,
      [card.id],
    )).rows
    expect(audit).toBeTruthy()
  })
})
