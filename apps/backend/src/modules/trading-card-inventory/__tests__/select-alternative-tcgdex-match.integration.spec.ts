import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { selectAlternativeTcgdexMatchWorkflow } from "../../../workflows/trading-card-inventory/select-alternative-tcgdex-match"

/**
 * Stage 1: alternative TCGdex match selection. NOT RUN this session — no
 * approved, isolated test database connection was available (see the
 * Stage 1 continuation report). Run with `npm run test:integration:modules`
 * against the project's approved test database before merging.
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let container: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" },
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
  container = medusaApp.sharedContainer
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

async function cardVariantFixture(tcgdexCardId: string, dimensions: { condition?: string; finish?: string; specialTreatment?: string } = {}) {
  const id = suffix()
  const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${id}`, provider_set_code: `set_${id}` })
  const card = await cards.createTradingCards({
    card_set_id: set.id, name: `Alt Card ${id}`, search_name: `alt card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id,
    condition: dimensions.condition ?? "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
    finish: dimensions.finish ?? "REVERSE_HOLO", finish_confirmed: true,
    special_treatment: dimensions.specialTreatment ?? "NONE", special_treatment_confirmed: true,
    sku: `SKU-ALT-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })
  await cards.recordTrustedTcgdexCardReference({ actor: "test", source: "MANUAL", tradingCardId: card.id, providerIdentifier: tcgdexCardId })
  return { set, card, variant }
}

async function sourceAndSnapshotFixture() {
  const id = suffix()
  const source = await inventory.createInventorySources({ display_name: `Alt Source ${id}`, normalized_name: `alt source ${id}`, provider: "PULSE", language: "EN" })
  const [snapshot] = (await pgConnection.raw(
    `insert into trading_card_inventory_snapshot (id, inventory_source_id, status, sequence_number, created_by)
     values (?, ?, 'PENDING_REVIEW', 1, 'test-actor') returning *`,
    [`tcisnap_alt_${id}`, source.id],
  )).rows
  return { source, snapshot }
}

async function entryFixture(snapshotId: string, overrides: { quantity?: number; condition?: string; finish?: string; specialTreatment?: string } = {}) {
  const id = suffix()
  const [entry] = (await pgConnection.raw(
    `insert into trading_card_inventory_snapshot_entry
      (id, inventory_snapshot_id, provider_reference, provider_reference_type, quantity, row_number, outcome,
       condition_candidate, finish_candidate, special_treatment_candidate)
     values (?, ?, ?, 'PULSE_PRODUCT_ID', ?, 1, 'REVIEW_REQUIRED', ?, ?, ?) returning *`,
    [
      `tcisentry_alt_${id}`, snapshotId, `card:ref-${id}`, overrides.quantity ?? 3,
      overrides.condition ?? "LIGHTLY_PLAYED", overrides.finish ?? "REVERSE_HOLO", overrides.specialTreatment ?? "NONE",
    ],
  )).rows
  return entry
}

describe("selectAlternativeTcgdexMatchWorkflow", () => {
  it("rematches an unmatched row to an existing variant for the chosen TCGdex identity", async () => {
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { variant } = await cardVariantFixture(tcgdexCardId)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const { result } = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId },
    })

    expect(result.outcome).toBe("REMATCHED")
    if (result.outcome !== "REMATCHED") throw new Error("expected REMATCHED")
    expect(result.tradingCardVariantId).toBe(variant.id)

    const [match] = (await pgConnection.raw(
      `select * from trading_card_inventory_snapshot_entry_match where snapshot_entry_id = ?`, [entry.id],
    )).rows
    expect(match.trading_card_variant_id).toBe(variant.id)
    expect(match.matched_via).toBe("MANUAL")

    const [audit] = (await pgConnection.raw(
      `select * from trading_card_inventory_audit_entry where action = 'ENTRY_MATCH_REMATCHED' order by created_at desc limit 1`,
    )).rows
    expect(audit).toBeTruthy()
    // old/new TCGdex identifiers must both be recorded (rule: "record the old and new TCGdex identifiers in audit history")
    expect(audit.new_value).toMatchObject({
      newTcgdexSetId: "swsh4pt5", newTcgdexCardId: tcgdexCardId, newTradingCardVariantId: variant.id, previousVariantId: null,
    })

    // The row's own explicit CSV attributes (condition/finish/treatment/quantity) and
    // physical-line provenance are never touched by a rematch — only the resolved identity changes.
    const [freshEntry] = (await pgConnection.raw(`select * from trading_card_inventory_snapshot_entry where id = ?`, [entry.id])).rows
    expect(freshEntry.condition_candidate).toBe(entry.condition_candidate)
    expect(freshEntry.finish_candidate).toBe(entry.finish_candidate)
    expect(freshEntry.special_treatment_candidate).toBe(entry.special_treatment_candidate)
    expect(freshEntry.quantity).toBe(entry.quantity)
    expect(freshEntry.row_number).toBe(entry.row_number)
    expect(freshEntry.provider_reference).toBe(entry.provider_reference)
  })

  it("is idempotent: repeating the exact same selection does not duplicate the match row or create a second variant/audit target", async () => {
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { variant } = await cardVariantFixture(tcgdexCardId)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId },
    })
    const second = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId },
    })

    expect(second.result.outcome).toBe("REMATCHED")
    const matches = (await pgConnection.raw(
      `select * from trading_card_inventory_snapshot_entry_match where snapshot_entry_id = ? and deleted_at is null`, [entry.id],
    )).rows
    expect(matches).toHaveLength(1)
    expect(matches[0].trading_card_variant_id).toBe(variant.id)
  })

  it("serialises two concurrent rematch attempts for the same row rather than corrupting the match", async () => {
    const tcgdexCardIdA = `swsh4pt5-${suffix()}`
    const tcgdexCardIdB = `swsh4pt5-${suffix()}`
    const { variant: variantA } = await cardVariantFixture(tcgdexCardIdA)
    const { variant: variantB } = await cardVariantFixture(tcgdexCardIdB)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const [outcomeA, outcomeB] = await Promise.allSettled([
      selectAlternativeTcgdexMatchWorkflow(container).run({
        input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId: tcgdexCardIdA },
      }),
      selectAlternativeTcgdexMatchWorkflow(container).run({
        input: { actor: "reviewer-2", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId: tcgdexCardIdB },
      }),
    ])

    // The row lock in `selectAlternativeMatchForEntry` serialises these — both requests may
    // succeed (last writer wins) but the match row must land on exactly one of the two
    // variants, never a corrupted/partial state, and never two match rows.
    expect(outcomeA.status).toBe("fulfilled")
    expect(outcomeB.status).toBe("fulfilled")
    const matches = (await pgConnection.raw(
      `select * from trading_card_inventory_snapshot_entry_match where snapshot_entry_id = ? and deleted_at is null`, [entry.id],
    )).rows
    expect(matches).toHaveLength(1)
    expect([variantA.id, variantB.id]).toContain(matches[0].trading_card_variant_id)
  })

  it("returns NO_EXISTING_CARD_OR_VARIANT rather than creating a variant when none exists yet", async () => {
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const { result } = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId: `no-such-card-${suffix()}` },
    })

    expect(result.outcome).toBe("NO_EXISTING_CARD_OR_VARIANT")
  })

  it("rejects rematching a row whose current variant has already been applied to stock", async () => {
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { variant } = await cardVariantFixture(tcgdexCardId)
    const { source, snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry_match (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via)
       values (?, ?, ?, 'MATCHED', ?, 'MANUAL')`,
      [`tcisematch_${suffix()}`, entry.id, snapshot.id, variant.id],
    )
    await pgConnection.raw(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, inventory_snapshot_id, reconciliation_key, trading_card_variant_id, change_kind,
         proposed_quantity, previous_quantity, quantity_delta, review_status)
       values (?, ?, ?, ?, ?, 'NEW_HOLDING', 1, 0, 1, 'APPLIED')`,
      [`tciprop_applied_${suffix()}`, source.id, snapshot.id, `variant:${variant.id}|sep=0|split=`, variant.id],
    )

    await expect(selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: "swsh4pt5", tcgdexCardId: `other-${suffix()}` },
    })).rejects.toThrow(/applied/)
  })
})
