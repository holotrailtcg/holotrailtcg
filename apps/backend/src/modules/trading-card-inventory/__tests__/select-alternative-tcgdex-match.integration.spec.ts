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

/**
 * `tcgdexSetId` defaults to a fresh, unique value per call rather than a
 * shared literal — `findExistingVariantForTcgdexCard` now requires an
 * explicit TRUSTED_MANUAL `SET:` reference (never the merely automatic
 * `provider_set_code`, see the Stage 1 remediation removing that fallback),
 * and a trusted reference is unique per `(provider, provider_identifier)`
 * system-wide: two different local card sets cannot both safely claim the
 * same external TCGdex set id in one test run without the second
 * registration silently stealing the first's trust.
 */
async function cardVariantFixture(
  tcgdexCardId: string,
  dimensions: { condition?: string; finish?: string; specialTreatment?: string; tcgdexSetId?: string } = {},
) {
  const id = suffix()
  const tcgdexSetId = dimensions.tcgdexSetId ?? `swsh4pt5-${id}`
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
  await cards.recordTrustedTcgdexSetReference({ actor: "test", source: "MANUAL", cardSetId: set.id, providerIdentifier: tcgdexSetId })
  return { set, card, variant, tcgdexSetId }
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
    const { variant, tcgdexSetId } = await cardVariantFixture(tcgdexCardId)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const { result } = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId },
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
      newTcgdexSetId: tcgdexSetId, newTcgdexCardId: tcgdexCardId, newTradingCardVariantId: variant.id, previousVariantId: null,
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
    const { variant, tcgdexSetId } = await cardVariantFixture(tcgdexCardId)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId },
    })
    const second = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId },
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
    const { variant: variantA, tcgdexSetId: tcgdexSetIdA } = await cardVariantFixture(tcgdexCardIdA)
    const { variant: variantB, tcgdexSetId: tcgdexSetIdB } = await cardVariantFixture(tcgdexCardIdB)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const [outcomeA, outcomeB] = await Promise.allSettled([
      selectAlternativeTcgdexMatchWorkflow(container).run({
        input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: tcgdexSetIdA, tcgdexCardId: tcgdexCardIdA },
      }),
      selectAlternativeTcgdexMatchWorkflow(container).run({
        input: { actor: "reviewer-2", snapshotEntryId: entry.id, tcgdexSetId: tcgdexSetIdB, tcgdexCardId: tcgdexCardIdB },
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

  it("refreshes proposals for both the old and new grouping keys when a PENDING_REVIEW snapshot is rematched", async () => {
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { variant: newVariant, tcgdexSetId } = await cardVariantFixture(tcgdexCardId)
    const { variant: oldVariant } = await cardVariantFixture(`swsh4pt5-old-${suffix()}`)
    const { source, snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)
    // Entry currently matches `oldVariant`, which already has its own PENDING proposal.
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry_match (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via)
       values (?, ?, ?, 'MATCHED', ?, 'AUTOMATIC')`,
      [`tcisematch_${suffix()}`, entry.id, snapshot.id, oldVariant.id],
    )
    const oldProposalId = `tciprop_old_${suffix()}`
    await pgConnection.raw(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, inventory_snapshot_id, reconciliation_key, trading_card_variant_id, change_kind,
         proposed_quantity, previous_quantity, quantity_delta, review_status)
       values (?, ?, ?, ?, ?, 'NEW_HOLDING', ?, 0, ?, 'PENDING')`,
      [oldProposalId, source.id, snapshot.id, `variant:${oldVariant.id}|sep=0|split=`, oldVariant.id, entry.quantity, entry.quantity],
    )

    await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId },
    })

    // Old key's proposal (now empty) must be soft-deleted, not left stale/orphaned.
    const [oldProposal] = (await pgConnection.raw(
      `select * from trading_card_inventory_proposal where id = ?`, [oldProposalId],
    )).rows
    expect(oldProposal.deleted_at).not.toBeNull()

    // A brand-new proposal must be INSERTED for the new key — it never existed before this rematch.
    const [newProposal] = (await pgConnection.raw(
      `select * from trading_card_inventory_proposal
       where inventory_snapshot_id = ? and reconciliation_key = ? and deleted_at is null`,
      [snapshot.id, `variant:${newVariant.id}|sep=0|split=`],
    )).rows
    expect(newProposal).toBeTruthy()
    expect(newProposal.trading_card_variant_id).toBe(newVariant.id)
    expect(newProposal.proposed_quantity).toBe(entry.quantity)
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
    const { variant, tcgdexSetId } = await cardVariantFixture(tcgdexCardId)
    const { source, snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry_match (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via)
       values (?, ?, ?, 'MATCHED', ?, 'MANUAL')`,
      [`tcisematch_${suffix()}`, entry.id, snapshot.id, variant.id],
    )
    // review_status = 'APPLIED' requires resolved_by/resolved_at AND the full applied-fields
    // set per CK_tci_proposal_applied_consistency — an incomplete fixture would be rejected by
    // the real constraint the code path actually runs against, silently hiding the "cannot
    // rematch an applied proposal" behavior this test exists to prove.
    const appliedId = `tciprop_applied_${suffix()}`
    await pgConnection.raw(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, inventory_snapshot_id, reconciliation_key, trading_card_variant_id, change_kind,
         proposed_quantity, previous_quantity, quantity_delta, review_status,
         resolved_by, resolved_at, applied_at, applied_transaction_id, applied_holding_id,
         application_idempotency_key, medusa_sync_status)
       values (?, ?, ?, ?, ?, 'NEW_HOLDING', 1, 0, 1, 'APPLIED',
         'reviewer-1', now(), now(), ?, ?, ?, 'SYNCED')`,
      [
        appliedId, source.id, snapshot.id, `variant:${variant.id}|sep=0|split=`, variant.id,
        `tcitxn_${suffix()}`, `tciholding_${suffix()}`, `idem_${suffix()}`,
      ],
    )

    await expect(selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId: `other-${suffix()}` },
    })).rejects.toThrow(/applied/)
  })

  it("rejects a submitted tcgdexCardId whose card belongs to a different set than the one submitted", async () => {
    // A tampered request could submit a real tcgdexCardId alongside a
    // *different* tcgdexSetId than the one the reviewer's UI actually showed
    // — findExistingVariantForTcgdexCard's set check must reject this rather
    // than resolving to the card's real (but unsubmitted) set.
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { tcgdexSetId } = await cardVariantFixture(tcgdexCardId)
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const { result } = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId: `${tcgdexSetId}-wrong`, tcgdexCardId },
    })

    expect(result.outcome).toBe("NO_EXISTING_CARD_OR_VARIANT")
  })

  it("rejects a card whose set language does not match the row's own inventory-source language", async () => {
    // The fixture's set is EN; entryFixture's snapshot belongs to an EN
    // source too, so a card from a JA set with the same trusted tcgdexSetId
    // must not resolve — set identity and language must both agree.
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const id = suffix()
    const set = await cards.createCardSets({ game: "POKEMON", language: "JA", display_name: `JA Set ${id}`, provider_set_code: `set_ja_${id}` })
    const card = await cards.createTradingCards({
      card_set_id: set.id, name: `JA Card ${id}`, search_name: `ja card ${id}`,
      card_number: "001", card_number_normalised: "001", origin: "MANUAL",
    })
    await cards.createTradingCardVariants({
      trading_card_id: card.id, condition: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
      finish: "REVERSE_HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `SKU-JA-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
    })
    const tcgdexSetId = `swsh4pt5-ja-${id}`
    await cards.recordTrustedTcgdexCardReference({ actor: "test", source: "MANUAL", tradingCardId: card.id, providerIdentifier: tcgdexCardId })
    await cards.recordTrustedTcgdexSetReference({ actor: "test", source: "MANUAL", cardSetId: set.id, providerIdentifier: tcgdexSetId })
    const { snapshot } = await sourceAndSnapshotFixture() // EN source
    const entry = await entryFixture(snapshot.id)

    const { result } = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId },
    })

    expect(result.outcome).toBe("NO_EXISTING_CARD_OR_VARIANT")
  })

  it("rejects a set with no trusted TCGdex set reference, even if provider_set_code happens to match", async () => {
    // The Stage 1 remediation removed the `provider_set_code` fallback — a
    // set can only ever be trusted via an explicit TRUSTED_MANUAL SET:
    // reference, never via the merely automatic `provider_set_code` column
    // (which can itself be the product of an earlier unreviewed automatic
    // match).
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const id = suffix()
    const tcgdexSetId = `swsh4pt5-untrusted-${id}`
    const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Untrusted Set ${id}`, provider_set_code: tcgdexSetId })
    const card = await cards.createTradingCards({
      card_set_id: set.id, name: `Untrusted Card ${id}`, search_name: `untrusted card ${id}`,
      card_number: "001", card_number_normalised: "001", origin: "MANUAL",
    })
    await cards.createTradingCardVariants({
      trading_card_id: card.id, condition: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
      finish: "REVERSE_HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `SKU-UNT-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
    })
    // Only the card reference is trusted — the set is never confirmed, despite provider_set_code matching exactly.
    await cards.recordTrustedTcgdexCardReference({ actor: "test", source: "MANUAL", tradingCardId: card.id, providerIdentifier: tcgdexCardId })
    const { snapshot } = await sourceAndSnapshotFixture()
    const entry = await entryFixture(snapshot.id)

    const { result } = await selectAlternativeTcgdexMatchWorkflow(container).run({
      input: { actor: "reviewer-1", snapshotEntryId: entry.id, tcgdexSetId, tcgdexCardId },
    })

    expect(result.outcome).toBe("NO_EXISTING_CARD_OR_VARIANT")
  })

  it("compensateTrustedTcgdexCardReference reverts a reference to no prior state by soft-deleting it", async () => {
    // trading-cards and trading-card-inventory are separate Medusa modules
    // with separate transactions, so a reference write can commit even
    // though a following inventory-side match then fails — the workflow
    // catches that failure and calls this exact compensation (see
    // select-alternative-tcgdex-match.ts). Exercised directly here against
    // the two primitives, since forcing the real workflow's atomic write to
    // fail after the reference commits requires DB-level fault injection
    // outside this test's reach.
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { variant } = await cardVariantFixture(tcgdexCardId)

    const otherCardId = `${tcgdexCardId}-other`
    const { referenceId, priorState } = await cards.recordTrustedTcgdexCardReferenceWithPriorState({
      actor: "reviewer-1", source: "MANUAL", tradingCardId: variant.trading_card_id, providerIdentifier: otherCardId,
    })
    expect(priorState).toBeNull() // otherCardId had never been referenced before

    await cards.compensateTrustedTcgdexCardReference({ actor: "reviewer-1", source: "MANUAL", referenceId, priorState })

    const [reverted] = (await pgConnection.raw(
      `select * from trading_card_external_reference where id = ?`, [referenceId],
    )).rows
    expect(reverted.deleted_at).not.toBeNull() // no prior state existed, so compensation soft-deletes it
  })

  it("compensateTrustedTcgdexCardReference restores the exact prior state when one existed", async () => {
    const tcgdexCardId = `swsh4pt5-${suffix()}`
    const { variant: variantA } = await cardVariantFixture(tcgdexCardId)
    const { variant: variantB } = await cardVariantFixture(`swsh4pt5-b-${suffix()}`)
    const sharedCardId = `shared-${suffix()}`
    // First, a trusted reference for `sharedCardId` points at variantA's card.
    await cards.recordTrustedTcgdexCardReference({
      actor: "test", source: "MANUAL", tradingCardId: variantA.trading_card_id, providerIdentifier: sharedCardId,
    })

    // A later (about-to-fail) rematch re-records the same identifier against variantB's card instead.
    const { referenceId, priorState } = await cards.recordTrustedTcgdexCardReferenceWithPriorState({
      actor: "reviewer-1", source: "MANUAL", tradingCardId: variantB.trading_card_id, providerIdentifier: sharedCardId,
    })
    expect(priorState).not.toBeNull()
    expect(priorState.trading_card_id).toBe(variantA.trading_card_id)

    await cards.compensateTrustedTcgdexCardReference({ actor: "reviewer-1", source: "MANUAL", referenceId, priorState })

    const [restored] = (await pgConnection.raw(
      `select * from trading_card_external_reference where id = ?`, [referenceId],
    )).rows
    expect(restored.deleted_at).toBeNull()
    expect(restored.trading_card_id).toBe(variantA.trading_card_id) // reverted back to what it pointed at before
  })
})
