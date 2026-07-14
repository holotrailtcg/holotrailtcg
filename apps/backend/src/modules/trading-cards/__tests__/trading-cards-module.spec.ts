import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { canonicalIdentityKey, variantIdentityKey } from "../identity/identity-key"
import { VERIFIED_DUPLICATE_EEVEE_ROWS } from "../__fixtures__/pulse-rows"

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
})

describe("audited lifecycle", () => {
  it("audits condition, finish, treatment, lock, and unlock changes", async () => {
    const { variant } = await createVariant()
    const context = { id: variant.id, actor: "test-admin", source: "MANUAL", reason: "test" }
    await service.updateVariantCondition({ ...context, condition: "LIGHTLY_PLAYED", conditionSource: "EXPLICIT" })
    await service.updateVariantFinish({ ...context, finish: "REVERSE_HOLO", confirmed: true })
    await service.updateVariantSpecialTreatment({ ...context, specialTreatment: "POKE_BALL_REVERSE", confirmed: true })
    await service.lockVariantPrice(context)
    await expect(service.assertPriceNotLocked(variant.id)).rejects.toThrow("price is locked")
    await service.unlockVariantPrice(context)
    await expect(service.assertPriceNotLocked(variant.id)).resolves.toBeUndefined()
    const audits = await service.listCardAuditEntries({ entity_id: variant.id })
    expect(audits.map((entry: any) => entry.action)).toEqual(expect.arrayContaining([
      "CONDITION_CHANGED", "FINISH_CHANGED", "SPECIAL_TREATMENT_CHANGED", "PRICE_LOCKED", "PRICE_UNLOCKED",
    ]))
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
    await service.upsertExternalReference({ ...base, tradingCardVariantId: variant.id, region: "UK" })
    await service.removeExternalReference({ id: ref.id, actor: "test-admin", source: "MANUAL" })
    const audits = await service.listCardAuditEntries({ entity_id: ref.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED", "EXTERNAL_REFERENCE_REMOVED",
    ])
  })
})

describe("grouped identity and link guarantees", () => {
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
    const firstId = `link_${marker}_1`
    await pgConnection.raw(`insert into ${table} (${left}, ${right}, id) values (?, ?, ?)`, [`left_${marker}`, `right_${marker}`, firstId])
    await expect(pgConnection.raw(`insert into ${table} (${left}, ${right}, id) values (?, ?, ?)`, [
      `left_${marker}`, `right_other_${marker}`, `link_${marker}_2`,
    ])).rejects.toThrow()
    await expect(pgConnection.raw(`insert into ${table} (${left}, ${right}, id) values (?, ?, ?)`, [
      `left_other_${marker}`, `right_${marker}`, `link_${marker}_3`,
    ])).rejects.toThrow()
    await pgConnection.raw(`delete from ${table} where id = ?`, [firstId])
  })
})
