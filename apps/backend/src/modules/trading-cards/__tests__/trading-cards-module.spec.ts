import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { canonicalIdentityKey, variantIdentityKey } from "../identity/identity-key"
import { VERIFIED_DUPLICATE_EEVEE_ROWS } from "../__fixtures__/pulse-rows"
import { EXTERNAL_REFERENCE_NOTE_MAX_LENGTH } from "../service"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[TRADING_CARDS_MODULE]
}, 60000)

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function createSet(language: "EN" | "JA" | "ZH" = "EN") {
  const id = suffix()
  return service.createCardSets({
    game: "POKEMON", language, display_name: `Test Set ${id}`, provider_set_code: `set_${id}`,
  })
}

async function createCard(language: "EN" | "JA" | "ZH" = "EN", number = "044/072") {
  const set = await createSet(language)
  const id = suffix()
  const card = await service.createTradingCards({
    card_set_id: set.id, name: `Crobat ${id}`, search_name: `crobat ${id}`,
    card_number: number, card_number_normalised: number, origin: "PULSE",
  })
  return { set, card }
}

async function createVariant(overrides: Record<string, unknown> = {}) {
  const { card } = await createCard()
  const id = suffix()
  const variant = await service.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
    special_treatment_confirmed: true, sku: `POKEMON-EN-TEST-044_072-${id.toUpperCase()}`,
    origin: "PULSE", ...overrides,
  })
  return { card, variant }
}

describe("trading-card schema", () => {
  it("resolves all six model services", () => {
    expect(typeof service.createCardSets).toBe("function")
    expect(typeof service.createTradingCards).toBe("function")
    expect(typeof service.createTradingCardVariants).toBe("function")
    expect(typeof service.createExternalCardReferences).toBe("function")
    expect(typeof service.createCardAuditEntries).toBe("function")
    expect(typeof service.createRarityMappings).toBe("function")
  })

  it("keeps audit entries append-only through the public module service", async () => {
    await expect(service.updateCardAuditEntries()).rejects.toThrow("append-only")
    await expect(service.deleteCardAuditEntries()).rejects.toThrow("cannot be deleted")
    await expect(service.softDeleteCardAuditEntries()).rejects.toThrow("cannot be deleted")
    await expect(service.restoreCardAuditEntries()).rejects.toThrow("cannot be restored")
  })

  it("enforces canonical identity uniqueness within a set", async () => {
    const { set } = await createCard("EN", "0104/15")
    await expect(service.createTradingCards({
      card_set_id: set.id, name: "Duplicate", search_name: "duplicate",
      card_number: "0104/15", card_number_normalised: "0104/15",
    })).rejects.toThrow()
  })

  it("separates otherwise matching identities by language-specific sets", async () => {
    const en = await createCard("EN", "53/62")
    const ja = await createCard("JA", "53/62")
    expect(en.card.id).not.toBe(ja.card.id)
  })

  it("prevents duplicate commercial variants and duplicate SKUs", async () => {
    const { card, variant } = await createVariant()
    await expect(service.createTradingCardVariants({
      trading_card_id: card.id, condition: variant.condition, condition_source: "EXPLICIT",
      finish: variant.finish, finish_confirmed: true, special_treatment: variant.special_treatment,
      special_treatment_confirmed: true, sku: `UNIQUE-${suffix().toUpperCase()}`,
    })).rejects.toThrow()
    const another = await createCard()
    await expect(service.createTradingCardVariants({
      trading_card_id: another.card.id, condition: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
      special_treatment_confirmed: true, sku: variant.sku,
    })).rejects.toThrow()
  })

  it("enforces SKU charset/length and confirmed Normal", async () => {
    const { card } = await createCard()
    await expect(service.createTradingCardVariants({
      trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
      finish: "NORMAL", finish_confirmed: false, special_treatment: "NONE",
      special_treatment_confirmed: true, sku: "invalid sku",
    })).rejects.toThrow()
  })

  it("stores the high-value tracking flag on the variant without inventory quantity", async () => {
    const { variant } = await createVariant({ is_high_value_track_individually: true })
    expect(variant.is_high_value_track_individually).toBe(true)
    expect(Object.keys(variant)).not.toContain("quantity")
  })
})

describe("rarity and external references", () => {
  it("uses language-specific exact mapping before a global mapping", async () => {
    const token = `Rare ${suffix()}`
    await service.createRarityMappings({
      provider: "PULSE", language: null, raw_value: token, comparison_value: token,
      rarity: "COMMON", icon_key: "common",
    })
    await service.createRarityMappings({
      provider: "PULSE", language: "JA", raw_value: token, comparison_value: token,
      rarity: "UNCOMMON", icon_key: "uncommon",
    })
    expect((await service.normaliseRarity({ provider: "PULSE", language: "JA", rawValue: ` ${token} ` })).rarity).toBe("UNCOMMON")
    expect((await service.normaliseRarity({ provider: "PULSE", language: "EN", rawValue: token })).rarity).toBe("COMMON")
    expect(await service.normaliseRarity({ provider: "PULSE", language: "EN", rawValue: token.toLowerCase() })).toBeNull()
  })

  it("keeps unmapped rarity null and confirmed no-rarity explicit", async () => {
    expect(await service.normaliseRarity({ provider: "PULSE", language: "EN", rawValue: `Unknown ${suffix()}` })).toBeNull()
    const token = `—${suffix()}`
    await service.createRarityMappings({
      provider: "PULSE", language: "ZH", raw_value: token, comparison_value: token,
      rarity: "NO_RARITY", icon_key: "no-rarity",
    })
    expect((await service.normaliseRarity({ provider: "PULSE", language: "ZH", rawValue: token })).rarity).toBe("NO_RARITY")
  })

  it("enforces global provider identifier uniqueness", async () => {
    const first = await createCard()
    const second = await createCard()
    const providerIdentifier = `card:test|${suffix()}`
    await service.createExternalCardReferences({
      trading_card_id: first.card.id, provider: "PULSE", provider_identifier: providerIdentifier,
    })
    await expect(service.createExternalCardReferences({
      trading_card_id: second.card.id, provider: "PULSE", provider_identifier: providerIdentifier,
    })).rejects.toThrow()
  })

  it("makes equivalent concurrent reference creation idempotent", async () => {
    const { card } = await createCard()
    const providerIdentifier = `card:concurrent|${suffix()}`
    const input = {
      tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      language: "EN", region: "GB", rawPayloadNote: "short diagnostic",
      actor: "concurrency-test", source: "MANUAL",
    }

    const two = await Promise.all([service.upsertExternalReference(input), service.upsertExternalReference(input)])
    expect(new Set(two.map((reference: any) => reference.id)).size).toBe(1)

    const five = await Promise.all(Array.from({ length: 5 }, () => service.upsertExternalReference(input)))
    expect(new Set(five.map((reference: any) => reference.id)).size).toBe(1)
    const references = await service.listExternalCardReferences({ provider: "PULSE", provider_identifier: providerIdentifier })
    expect(references).toHaveLength(1)
    const audits = await service.listCardAuditEntries({ entity_id: references[0].id })
    expect(audits.map((entry: any) => entry.action)).toEqual(["EXTERNAL_REFERENCE_ADDED"])
  })

  it("rejects racing conflicting creates without leaking a unique-constraint error", async () => {
    const first = await createCard()
    const second = await createCard()
    const providerIdentifier = `card:conflict|${suffix()}`
    const base = { provider: "PULSE", providerIdentifier, actor: "concurrency-test", source: "MANUAL" }
    const results = await Promise.allSettled([
      service.upsertExternalReference({ ...base, tradingCardId: first.card.id, region: "GB" }),
      service.upsertExternalReference({ ...base, tradingCardId: second.card.id, region: "JP" }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason.message).toContain("already exists with different data")
    expect(rejected.reason.message).not.toMatch(/unique|constraint|duplicate key/i)

    const references = await service.listExternalCardReferences({ provider: "PULSE", provider_identifier: providerIdentifier })
    expect(references).toHaveLength(1)
    const audits = await service.listCardAuditEntries({ entity_id: references[0].id })
    expect(audits.map((entry: any) => entry.action)).toEqual(["EXTERNAL_REFERENCE_ADDED"])
  })

  it("requires the current reference ID for a genuine update and audits only changed structural fields", async () => {
    const { card, variant } = await createVariant()
    const providerIdentifier = `card:update|${suffix()}`
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "update-test", source: "MANUAL", rawPayloadNote: "initial private marker" }
    const reference = await service.upsertExternalReference(base)
    const repeated = await service.upsertExternalReference(base)
    expect(repeated.id).toBe(reference.id)

    await expect(service.upsertExternalReference({ ...base, region: "GB" }))
      .rejects.toThrow("reference ID and version are required")
    const updated = await service.upsertExternalReference({
      ...base, referenceId: reference.id, expectedVersion: reference.version, tradingCardVariantId: variant.id,
      region: "GB", rawPayloadNote: "updated private marker",
    })
    expect(updated.region).toBe("GB")
    expect(updated.raw_payload_note).toBe("updated private marker")
    const audits = await service.listCardAuditEntries({ entity_id: reference.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED",
    ])
    expect(audits[1].old_value).toEqual({ trading_card_variant_id: null, region: null })
    expect(audits[1].new_value).toEqual({ trading_card_variant_id: variant.id, region: "GB" })
  })

  it("uses the returned row version to reject racing non-equivalent updates", async () => {
    const { card } = await createCard()
    const providerIdentifier = `card:update-race|${suffix()}`
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "update-race-test", source: "MANUAL" }
    const reference = await service.upsertExternalReference(base)
    const results = await Promise.allSettled([
      service.upsertExternalReference({
        ...base, referenceId: reference.id, expectedVersion: reference.version, region: "GB",
      }),
      service.upsertExternalReference({
        ...base, referenceId: reference.id, expectedVersion: reference.version, region: "JP",
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason.message).toBe("External reference changed before this update")
    const references = await service.listExternalCardReferences({ provider_identifier: providerIdentifier })
    expect(["GB", "JP"]).toContain(references[0].region)
    const audits = await service.listCardAuditEntries({ entity_id: reference.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED",
    ])
  })

  it("bounds diagnostic notes at 500 characters and excludes them from every audit snapshot", async () => {
    const { card } = await createCard()
    const marker = `SECRET_NOTE_${suffix()}`
    const providerIdentifier = `card:note|${suffix()}`
    const note = marker + "x".repeat(EXTERNAL_REFERENCE_NOTE_MAX_LENGTH - marker.length)
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "note-test", source: "MANUAL" }
    const reference = await service.upsertExternalReference({ ...base, rawPayloadNote: note })
    expect(reference.raw_payload_note).toBe(note)
    await service.removeExternalReference({ id: reference.id, actor: "note-test", source: "MANUAL" })
    const audits = await service.listCardAuditEntries({ entity_id: reference.id })
    expect(JSON.stringify(audits)).not.toContain(marker)
    expect(audits).toHaveLength(2)

    const oversizedIdentifier = `card:oversized|${suffix()}`
    await expect(service.upsertExternalReference({
      ...base, providerIdentifier: oversizedIdentifier,
      rawPayloadNote: "x".repeat(EXTERNAL_REFERENCE_NOTE_MAX_LENGTH + 1),
    })).rejects.toThrow("at most 500 characters")
    expect(await service.listExternalCardReferences({ provider_identifier: oversizedIdentifier })).toHaveLength(0)
    expect(await service.listCardAuditEntries({ actor: "note-test", entity_id: oversizedIdentifier })).toHaveLength(0)
    await expect(pgConnection.raw(
      `insert into trading_card_external_reference
       (id, trading_card_id, provider, provider_identifier, raw_payload_note)
       values (?, ?, 'PULSE', ?, ?)`,
      [`tcref_${suffix()}`, card.id, `card:db-oversized|${suffix()}`, "x".repeat(EXTERNAL_REFERENCE_NOTE_MAX_LENGTH + 1)]
    )).rejects.toThrow(/note_length|check constraint/i)
  })
})

describe("audited lifecycle", () => {
  it("audits complete persisted lock state and treats repeated lock operations as idempotent", async () => {
    const { variant } = await createVariant()
    const context = { id: variant.id, actor: "test-admin", source: "MANUAL", reason: "test" }
    await service.updateVariantCondition({ ...context, condition: "LIGHTLY_PLAYED", conditionSource: "EXPLICIT" })
    await service.updateVariantFinish({ ...context, finish: "REVERSE_HOLO", confirmed: true })
    await service.updateVariantSpecialTreatment({ ...context, specialTreatment: "POKE_BALL_REVERSE", confirmed: true })
    const locked = await service.lockVariantPrice(context)
    await expect(service.assertPriceNotLocked(variant.id)).rejects.toThrow("price is locked")
    await service.lockVariantPrice(context)
    const unlocked = await service.unlockVariantPrice(context)
    await service.unlockVariantPrice(context)
    await expect(service.assertPriceNotLocked(variant.id)).resolves.toBeUndefined()
    expect(unlocked).toMatchObject({
      price_locked: false, price_locked_at: null, price_locked_actor: null, price_lock_reason: null,
    })
    const audits = await service.listCardAuditEntries({ entity_id: variant.id })
    expect(audits.map((entry: any) => entry.action)).toEqual(expect.arrayContaining([
      "CONDITION_CHANGED", "FINISH_CHANGED", "SPECIAL_TREATMENT_CHANGED", "PRICE_LOCKED", "PRICE_UNLOCKED",
    ]))
    const lockAudit = audits.find((entry: any) => entry.action === "PRICE_LOCKED")
    const unlockAudit = audits.find((entry: any) => entry.action === "PRICE_UNLOCKED")
    expect(lockAudit).toMatchObject({ actor: "test-admin", source: "MANUAL", reason: "test" })
    expect(lockAudit.old_value).toEqual({
      price_locked: false, price_locked_at: null, price_locked_by: null, price_lock_reason: null,
    })
    expect(lockAudit.new_value).toEqual({
      price_locked: true, price_locked_at: locked.price_locked_at.toISOString(),
      price_locked_by: "test-admin", price_lock_reason: "test",
    })
    expect(unlockAudit).toMatchObject({ actor: "test-admin", source: "MANUAL", reason: "test" })
    expect(unlockAudit.old_value).toEqual(lockAudit.new_value)
    expect(unlockAudit.new_value).toEqual({
      price_locked: false, price_locked_at: null, price_locked_by: null, price_lock_reason: null,
    })
    expect(audits.filter((entry: any) => entry.action === "PRICE_LOCKED")).toHaveLength(1)
    expect(audits.filter((entry: any) => entry.action === "PRICE_UNLOCKED")).toHaveLength(1)
  })

  it("rolls back a price-lock mutation when audit creation fails", async () => {
    const { variant } = await createVariant()
    await expect(service.lockVariantPrice({
      id: variant.id, actor: "rollback-test", source: "INVALID", reason: "must rollback",
    })).rejects.toThrow()
    const after = await service.retrieveTradingCardVariant(variant.id)
    expect(after).toMatchObject({
      price_locked: false, price_locked_at: null, price_locked_actor: null, price_lock_reason: null,
    })
    expect(await service.listCardAuditEntries({ entity_id: variant.id })).toHaveLength(0)
  })

  it("rolls back the mutation and audit if a database constraint fails", async () => {
    const { variant } = await createVariant()
    await expect(service.updateVariantFinish({
      id: variant.id, finish: "NORMAL", confirmed: false, actor: "test-admin", source: "MANUAL",
    })).rejects.toThrow()
    const after = await service.retrieveTradingCardVariant(variant.id)
    expect(after.finish).toBe("HOLO")
    expect(await service.listCardAuditEntries({ entity_id: variant.id })).toHaveLength(0)
  })

  it("audits external-reference add, change, and removal", async () => {
    const { card, variant } = await createVariant()
    const providerIdentifier = `card:audit|${suffix()}`
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "test-admin", source: "MANUAL" }
    const ref = await service.upsertExternalReference(base)
    await service.upsertExternalReference({
      ...base, referenceId: ref.id, expectedVersion: ref.version,
      tradingCardVariantId: variant.id, region: "UK",
    })
    await service.removeExternalReference({ id: ref.id, actor: "test-admin", source: "MANUAL" })
    const audits = await service.listCardAuditEntries({ entity_id: ref.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED", "EXTERNAL_REFERENCE_REMOVED",
    ])
  })
})

describe("grouped identity and link guarantees", () => {
  it("rejects a mismatched product hierarchy at the shared service boundary", async () => {
    await expect(service.assertVariantProductHierarchy({
      productVariantProductId: "prod_b", tradingCardProductId: "prod_a",
    })).rejects.toThrow("must belong to the same Medusa product")
    await expect(service.assertVariantProductHierarchy({
      productVariantProductId: "prod_a", tradingCardProductId: null,
    })).rejects.toThrow("not linked to a Medusa product")
    await expect(service.assertVariantProductHierarchy({
      productVariantProductId: "prod_a", tradingCardProductId: "prod_a",
    })).resolves.toBeUndefined()
  })

  it("converges duplicate Pulse rows without representing quantity", () => {
    const keys = VERIFIED_DUPLICATE_EEVEE_ROWS.map((row) => ({
      card: canonicalIdentityKey("tcset_cbb2_scn_zh", row.cardNumber),
      variant: variantIdentityKey({
        tradingCardId: "tcard_eevee", condition: "NEAR_MINT", finish: "HOLO", specialTreatment: "POKE_BALL",
      }),
    }))
    expect(new Set(keys.map((key) => key.card)).size).toBe(1)
    expect(new Set(keys.map((key) => key.variant)).size).toBe(1)
  })

  it.each([
    ["product_product_tradingcards_trading_card", "product_id", "trading_card_id"],
    ["product_product_variant_tradingcards_trading_card_variant", "product_variant_id", "trading_card_variant_id"],
  ])("enforces one active link on each side of %s", async (table, left, right) => {
    const marker = suffix()
    const insert = (leftId: string, rightId: string, id: string) =>
      pgConnection.raw(`insert into ${table} (${left}, ${right}, id) values (?, ?, ?)`, [leftId, rightId, id])
    const leftRace = await Promise.allSettled([
      insert(`left_${marker}`, `right_${marker}_1`, `link_${marker}_1`),
      insert(`left_${marker}`, `right_${marker}_2`, `link_${marker}_2`),
    ])
    expect(leftRace.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])

    const rightRace = await Promise.allSettled([
      insert(`left_${marker}_3`, `right_${marker}_3`, `link_${marker}_3`),
      insert(`left_${marker}_4`, `right_${marker}_3`, `link_${marker}_4`),
    ])
    expect(rightRace.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])
    await pgConnection.raw(`delete from ${table} where id like ?`, [`link_${marker}_%`])
  })
})
